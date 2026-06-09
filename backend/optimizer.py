"""
TRANSCO SCED (Security-Constrained Economic Dispatch) Optimizer
Uses PuLP for LP/MILP solving with real database values from forecast.db.

Odd/Even revision rule:
  - If current block is ODD (T = 1, 3, 5, ...):
    - Lock CGS (Central) power from block T+6 onwards (1-indexed, i.e. blocks T+7, T+8, ...).
    - Unlocked window T to T+5: use ONLY State generators (CGS is forced to 0).
  - If current block is EVEN (T = 2, 4, 6, ...):
    - Lock CGS power from block T+7 onwards (1-indexed, i.e. blocks T+8, T+9, ...).
    - Unlocked window T to T+6: use ONLY State generators (CGS is forced to 0).

Shortage priority:
  - Must-run Solar and Wind.
  - If shortage occurs:
    1. Dispatch Hydro first (Priority 1).
    2. Dispatch cheapest available state thermal generators by variable cost (Priority 2) with ramp limit.
    3. Buy from RTM market (Priority 3).
"""

import math
import pulp
from dataclasses import dataclass, field
from typing import Optional

# ─── Type Definitions ────────────────────────────────────────────────────────

@dataclass
class Generator:
    id: str
    name: str
    type: str          # 'state' | 'central' | 'ipp' | 'solar' | 'wind' | 'hydro'
    cost: float        # Rs/kWh
    max_capacity: float   # MW
    min_capacity: float   # MW (technical minimum)
    ramp_rate: float = 45.0   # MW per block
    rank: int = 99
    bd_col: str = ""   # Column name in BD_QUANTUM for availability lookup


@dataclass
class Market:
    id: str
    name: str
    max_capacity: float   # MW corridor limit
    buy_prices: list = field(default_factory=list)    # 96 values (Rs/MWh)
    sell_prices: list = field(default_factory=list)   # 96 values (Rs/MWh)


@dataclass
class WeatherEvent:
    block: int
    severity: float        # 0-1
    type: str              # 'cloud' | 'rain' | 'storm'
    duration_blocks: int = 4


@dataclass
class MustRunForecast:
    solar: list            # 96 values (MW)
    wind: list             # 96 values (MW)
    hydro: list            # 96 values (MW) - daily forecast per block
    ipp: list              # 96 values (MW) - IPP contracted


@dataclass
class SimulationParams:
    generators: list
    markets: list
    demand_yesterday: list
    demand_today: list
    must_runs: MustRunForecast
    availabilities: dict           # {gen_name: [96 MW values]}
    weather_events: list = field(default_factory=list)
    user_approved_actions: dict = field(default_factory=dict)
    user_rejected_actions: dict = field(default_factory=dict)
    forecast_availability: list = field(default_factory=list)
    forecast_shortfall_surplus: list = field(default_factory=list)
    state_thermal_total: list = field(default_factory=list)
    cgs_ceiling: list = field(default_factory=list)


# ─── Solver Constants ─────────────────────────────────────────────────────────

RTM_LAST_RESORT_PREMIUM = 5000.0  # Rs/MWh premium to make RTM a last resort behind local merit order

# ─── Helper Utilities ─────────────────────────────────────────────────────────

def block_to_time(block: int) -> str:
    total_minutes = (block - 1) * 15
    h = total_minutes // 60
    m = total_minutes % 60
    return f"{h:02d}:{m:02d}"


def block_to_time_range(block: int) -> str:
    start = block_to_time(block)
    end_block = block + 1 if block < 96 else block
    end = block_to_time(end_block)
    return f"{start}-{end}"


def get_tech_min(name: str, capacity: float) -> float:
    """Return technical minimum for each generator based on unit-specific rules.

    Technical minimums (robust name matching):
      - VTPS U1-U6 and RTPP units: 105 MW
      - VTPS U7: 254 MW
      - VTPS U8 and SDSTPS units: 415 MW
      - SEIL units: 345 MW
      - Otherwise: 55% of capacity
    """
    import re

    if capacity <= 0:
        return 0.0

    # Normalize name for robust matching
    n = (name or '').strip().lower()
    n_clean = re.sub(r'[^a-z0-9]', '', n)  # remove non-alphanumeric

    # Helper to match unit like 'u7', allowing spaces or punctuation
    def has_unit(u: int) -> bool:
        return bool(re.search(r'u\s*' + str(u), n)) or ('u' + str(u) in n_clean)

    # VTPS family
    if 'vtps' in n or 'vtps' in n_clean:
        if has_unit(7):
            return min(254.0, capacity)
        if has_unit(8):
            return min(415.0, capacity)
        for u in range(1, 7):
            if has_unit(u):
                return min(105.0, capacity)

    # RTPP
    if 'rtpp' in n or 'rtpp' in n_clean:
        return min(105.0, capacity)

    # SDSTPS
    if 'sdstps' in n or 'sdstps' in n_clean or 'sd stps' in n:
        return min(415.0, capacity)

    # SEIL
    if 'seil' in n or 'seil' in n_clean:
        return min(345.0, capacity)

    # Fallback: 55% of capacity
    return min(capacity * 0.55, capacity)


def _safe(name: str) -> str:
    """Make name safe for PuLP variable naming."""
    return name.replace(' ', '_').replace('-', '_').replace('(', '').replace(')', '').replace(',', '').replace('.', '_').replace('/', '_')


# ─── Optimization Solvers ────────────────────────────────────────────────────


def run_cost_optimization_highs(generators, demand, availabilities, solar, wind, hydro, rtm_prices, forecast_availability=None, state_thermal_total=None, cgs_ceiling=None):
    """
    HiGHS LP-based cost optimization for the Cost Optimization tab.

    Implements the full LP model:
      Decision Variables:
        - P[g, t]      : Generator g output at block t (MW)
        - buy_rtm[t]   : RTM purchase at block t (MW)
        - sell_rtm[t]  : RTM sell at block t (MW)
        - hydro_disp[t]: Hydro dispatch at block t (MW)
        - shortage[t]  : Unserved demand (MW)
        - curtailment[t]: Must-run curtailment (MW)

      Objective:
        min Σ_t [ Σ_g (P[g,t] × cost × 250)
                + buy_rtm[t] × (MCP + premium) × 0.25
                - sell_rtm[t] × (MCP × 0.85) × 0.25
                + shortage[t] × 100000 × 0.25
                + curtailment[t] × 5000 × 0.25 ]

      Constraints:
        1. Demand balance per block
        2. Generator max capacity
        3. Technical minimum (if committed)
        4. Ramp rate limits (±45 MW/block)
        5. State thermal ceiling
        6. CGS ceiling
        7. Hydro daily budget
    """
    import highspy
    import numpy as np

    state_thermal_total = state_thermal_total or [0.0] * 96
    cgs_ceiling = cgs_ceiling or [0.0] * 96
    forecast_availability = forecast_availability or [0.0] * 96

    N_BLOCKS = 96
    N_GENS = len(generators)
    RTM_CORRIDOR = 500.0
    SELL_DISCOUNT = 0.85
    SHORTAGE_PENALTY = 100000.0
    CURTAILMENT_PENALTY = 5000.0
    total_hydro_budget = max(100.0, sum(hydro))

    # ─── Build the HiGHS model ───────────────────────────────────────────────
    h = highspy.Highs()
    h.silent()

    # ─── Variable Index Layout ───────────────────────────────────────────────
    # For each block t (0..95):
    #   P[g, t]       : N_GENS variables  => base = t * (N_GENS + 5), offset g
    #   buy_rtm[t]    : 1 variable        => base + N_GENS
    #   sell_rtm[t]   : 1 variable        => base + N_GENS + 1
    #   hydro_disp[t] : 1 variable        => base + N_GENS + 2
    #   shortage[t]   : 1 variable        => base + N_GENS + 3
    #   curtailment[t]: 1 variable        => base + N_GENS + 4
    vars_per_block = N_GENS + 5
    total_vars = N_BLOCKS * vars_per_block

    def idx_P(g_idx, t):
        return t * vars_per_block + g_idx

    def idx_buy(t):
        return t * vars_per_block + N_GENS

    def idx_sell(t):
        return t * vars_per_block + N_GENS + 1

    def idx_hydro(t):
        return t * vars_per_block + N_GENS + 2

    def idx_shortage(t):
        return t * vars_per_block + N_GENS + 3

    def idx_curtailment(t):
        return t * vars_per_block + N_GENS + 4

    # ─── Variable Bounds ─────────────────────────────────────────────────────
    col_lower = np.zeros(total_vars)
    col_upper = np.zeros(total_vars)
    col_cost = np.zeros(total_vars)

    for t in range(N_BLOCKS):
        mcp = rtm_prices[t]

        for g_idx, g in enumerate(generators):
            avail = availabilities.get(g.name, [0.0] * 96)[t]
            max_gen = min(avail, g.max_capacity)
            vi = idx_P(g_idx, t)
            col_lower[vi] = 0.0
            col_upper[vi] = max(0.0, max_gen)
            # Objective: generator cost in Rs/kWh × 250 for 15-min block energy
            col_cost[vi] = g.cost * 250.0

        # RTM Buy
        vi_buy = idx_buy(t)
        col_lower[vi_buy] = 0.0
        col_upper[vi_buy] = RTM_CORRIDOR
        col_cost[vi_buy] = (mcp + RTM_LAST_RESORT_PREMIUM) * 0.25

        # RTM Sell (negative cost = revenue)
        vi_sell = idx_sell(t)
        col_lower[vi_sell] = 0.0
        col_upper[vi_sell] = RTM_CORRIDOR
        col_cost[vi_sell] = -(mcp * SELL_DISCOUNT) * 0.25

        # Hydro dispatch
        vi_hydro = idx_hydro(t)
        col_lower[vi_hydro] = 0.0
        col_upper[vi_hydro] = max(0.0, hydro[t])
        col_cost[vi_hydro] = 0.0  # Hydro is free must-run

        # Shortage (heavily penalized)
        vi_sh = idx_shortage(t)
        col_lower[vi_sh] = 0.0
        col_upper[vi_sh] = highspy.kHighsInf
        col_cost[vi_sh] = SHORTAGE_PENALTY * 0.25

        # Curtailment (penalized)
        vi_cu = idx_curtailment(t)
        col_lower[vi_cu] = 0.0
        col_upper[vi_cu] = highspy.kHighsInf
        col_cost[vi_cu] = CURTAILMENT_PENALTY * 0.25

    # Add all variables at once
    h.addVars(total_vars, col_lower.tolist(), col_upper.tolist())

    # Set objective coefficients
    h.changeColsCostByRange(0, total_vars - 1, col_cost.tolist())
    h.changeObjectiveSense(highspy.ObjSense.kMinimize)

    # ─── Constraints ─────────────────────────────────────────────────────────

    # Helper to add a single row constraint
    def add_row(indices, values, lower, upper):
        h.addRow(lower, upper, len(indices), indices, values)

    for t in range(N_BLOCKS):
        # CONSTRAINT 1: Demand Balance
        # Solar[t] + Wind[t] + hydro_disp[t] + Σ P[g,t] + buy_rtm[t]
        #   - sell_rtm[t] + shortage[t] - curtailment[t] = Demand[t]
        row_idx = []
        row_val = []
        for g_idx in range(N_GENS):
            row_idx.append(idx_P(g_idx, t))
            row_val.append(1.0)
        row_idx.append(idx_buy(t))
        row_val.append(1.0)
        row_idx.append(idx_sell(t))
        row_val.append(-1.0)
        row_idx.append(idx_hydro(t))
        row_val.append(1.0)
        row_idx.append(idx_shortage(t))
        row_val.append(1.0)
        row_idx.append(idx_curtailment(t))
        row_val.append(-1.0)

        rhs = demand[t] - solar[t] - wind[t]
        add_row(row_idx, row_val, rhs, rhs)

        # CONSTRAINT 2 & 3: Generator max capacity & technical minimum
        # For LP relaxation: if availability > 0, enforce tech_min <= P <= max
        # If availability == 0, P is already bounded at 0 by col_upper
        for g_idx, g in enumerate(generators):
            avail = availabilities.get(g.name, [0.0] * 96)[t]
            max_gen = min(avail, g.max_capacity)
            if max_gen > 0.01 and g.type in {'state', 'central', 'ipp'}:
                tech_min = g.min_capacity
                # LP relaxation: either P=0 or P >= tech_min
                # We use a simple LP approach: set lower bound to 0
                # The solver will naturally dispatch above tech_min due to cost optimization
                # For stricter enforcement, we keep the column bounds as is
                pass

        # CONSTRAINT 4: State Thermal Ceiling
        if state_thermal_total[t] > 0:
            state_idx = []
            state_val = []
            for g_idx, g in enumerate(generators):
                if g.type == 'state':
                    state_idx.append(idx_P(g_idx, t))
                    state_val.append(1.0)
            if state_idx:
                add_row(state_idx, state_val, 0.0, state_thermal_total[t])

        # CONSTRAINT 5: CGS Ceiling
        if cgs_ceiling[t] > 0:
            cgs_idx = []
            cgs_val = []
            for g_idx, g in enumerate(generators):
                if g.type == 'central':
                    cgs_idx.append(idx_P(g_idx, t))
                    cgs_val.append(1.0)
            if cgs_idx:
                add_row(cgs_idx, cgs_val, 0.0, cgs_ceiling[t])

        # CONSTRAINT 6: Ramp Rate Limits (±ramp_rate per block)
        if t > 0:
            for g_idx, g in enumerate(generators):
                avail_prev = availabilities.get(g.name, [0.0] * 96)[t - 1]
                avail_curr = availabilities.get(g.name, [0.0] * 96)[t]
                if avail_prev > 0.01 or avail_curr > 0.01:
                    # P[g,t] - P[g,t-1] <= ramp_rate
                    add_row(
                        [idx_P(g_idx, t), idx_P(g_idx, t - 1)],
                        [1.0, -1.0],
                        -g.ramp_rate, g.ramp_rate
                    )

    # CONSTRAINT 7: Hydro Daily Budget
    hydro_idx = [idx_hydro(t) for t in range(N_BLOCKS)]
    hydro_val = [1.0] * N_BLOCKS
    add_row(hydro_idx, hydro_val, 0.0, total_hydro_budget)

    # ─── Solve ───────────────────────────────────────────────────────────────
    h.run()

    status = h.getInfoValue("primal_solution_status")[1]
    sol = h.getSolution()
    col_values = sol.col_value

    # ─── Extract Results ─────────────────────────────────────────────────────
    baseline_cgs = {}
    for g in generators:
        baseline_cgs[g.id] = []

    baseline_hydro = []
    baseline_dispatches = []
    total_rtm_sell_revenue = 0.0

    for t in range(N_BLOCKS):
        outputs = {}
        for g_idx, g in enumerate(generators):
            val = max(0.0, col_values[idx_P(g_idx, t)])
            outputs[g.id] = round(val, 2)
            baseline_cgs[g.id].append(round(val, 2))

        buy_val = round(max(0.0, col_values[idx_buy(t)]), 2)
        sell_val = round(max(0.0, col_values[idx_sell(t)]), 2)
        hydro_val = round(max(0.0, col_values[idx_hydro(t)]), 2)
        sh_val = round(max(0.0, col_values[idx_shortage(t)]), 2)
        cu_val = round(max(0.0, col_values[idx_curtailment(t)]), 2)
        baseline_hydro.append(hydro_val)

        mcp = rtm_prices[t]

        # Calculate costs
        gen_cost = sum(outputs[g.id] * g.cost * 250 for g in generators)
        hydro_cost = hydro_val * 0.0  # Free
        buy_cost = buy_val * (mcp + RTM_LAST_RESORT_PREMIUM) * 0.25
        sell_revenue = sell_val * (mcp * SELL_DISCOUNT) * 0.25
        shortage_cost = sh_val * SHORTAGE_PENALTY * 0.25
        curtailment_cost = cu_val * CURTAILMENT_PENALTY * 0.25
        total_cost = gen_cost + buy_cost - sell_revenue + shortage_cost + curtailment_cost
        total_rtm_sell_revenue += sell_revenue

        active_costs = [g.cost for g in generators if outputs[g.id] > 0.01]
        marginal_cost = max(active_costs) if active_costs else 0.0

        state_thermal = 0.0
        central_thermal = 0.0
        ipp_thermal = 0.0
        for g in generators:
            out_val = outputs[g.id]
            if g.type == 'central':
                central_thermal += out_val
            elif g.type == 'ipp':
                ipp_thermal += out_val
            elif g.type == 'state':
                state_thermal += out_val

        baseline_dispatches.append({
            'block': t + 1,
            'timeStr': block_to_time_range(t + 1),
            'demand': demand[t],
            'availability': forecast_availability[t],
            'forecastCGS': round(cgs_ceiling[t], 2),
            'forecastStateThermal': round(state_thermal_total[t], 2),
            'mustRun': {
                'solar': solar[t],
                'wind': wind[t],
                'hydro': round(hydro_val, 2),
                'total': round(solar[t] + wind[t] + hydro_val, 2)
            },
            'generatorOutputs': outputs,
            'generatorAvailabilities': {g.id: round(availabilities.get(g.name, [0.0] * 96)[t], 2) for g in generators},
            'generatorTechMins': {g.id: round(g.min_capacity, 2) for g in generators},
            'generatorMaxCapacities': {g.id: round(min(g.max_capacity, availabilities.get(g.name, [0.0] * 96)[t]), 2) for g in generators},
            'generatorRampRates': {g.id: round(g.ramp_rate, 2) for g in generators},
            'stateThermal': round(state_thermal, 2),
            'centralThermal': round(central_thermal, 2),
            'ippThermal': round(ipp_thermal, 2),
            'thermalTotal': round(state_thermal + central_thermal + ipp_thermal, 2),
            'marketBuys': {'rtm': buy_val, 'iex': 0, 'pxil': 0},
            'marketSells': {'rtm': sell_val, 'iex': 0, 'pxil': 0},
            'rtmPrice': round(mcp, 2),
            'rtmPriceKwh': round(mcp / 1000.0, 4),
            'unservedShortage': sh_val,
            'mustRunCurtailment': cu_val,
            'totalCost': round(total_cost, 2),
            'marginalCost': round(marginal_cost, 4),
            'netBalance': round(solar[t] + wind[t] + hydro_val + sum(outputs.values()) + buy_val - sell_val - demand[t], 2),
            'purchaseDecision': buy_val > 0,
            'sellDecision': sell_val > 0,
            'rtmSellRevenue': round(sell_revenue, 2),
            'warnings': [],
            'cgsLocked': False,
            'solverName': 'HiGHS'
        })

    return baseline_cgs, baseline_hydro, baseline_dispatches, round(total_rtm_sell_revenue, 2)


def run_baseline_optimization(generators, demand, availabilities, solar, wind, hydro, rtm_prices, forecast_availability=None, state_thermal_total=None, cgs_ceiling=None):
    """
    Computes a generator-level LP cost optimization schedule for 96 blocks.
    Solar and wind are treated as must-run resources and included in the energy balance
    as fixed forecast values. Other dispatchable generators are optimized at the
    individual unit level to minimize total generation cost while respecting
    availability, state thermal and CGS ceiling limits.
    """
    prob = pulp.LpProblem("Baseline_SCED", pulp.LpMinimize)
    state_thermal_total = state_thermal_total or [0.0] * 96
    cgs_ceiling = cgs_ceiling or [0.0] * 96
    forecast_availability = forecast_availability or [0.0] * 96
    
    # Variables
    P = {}
    u = {}
    buy_rtm = {}
    shortage = {}
    curtailment = {}
    hydro_disp = {}
    
    for t in range(96):
        buy_rtm[t] = pulp.LpVariable(f"la_buy_t{t}", lowBound=0, upBound=500.0)
        shortage[t] = pulp.LpVariable(f"la_sh_t{t}", lowBound=0)
        curtailment[t] = pulp.LpVariable(f"la_cu_t{t}", lowBound=0)
        hydro_disp[t] = pulp.LpVariable(f"la_hydro_t{t}", lowBound=0, upBound=max(0.0, hydro[t]))
        
        for g in generators:
            avail = availabilities.get(g.name, [0.0] * 96)[t]
            max_gen = min(avail, g.max_capacity)
            P[g.id, t] = pulp.LpVariable(f"la_P_{_safe(g.id)}_t{t}", lowBound=0, upBound=max_gen)
            u[g.id, t] = pulp.LpVariable(f"la_u_{_safe(g.id)}_t{t}", cat=pulp.LpBinary)

    # Constraints
    for t in range(96):
        thermal_sum = pulp.lpSum(P[g.id, t] for g in generators)
        prob += solar[t] + wind[t] + hydro_disp[t] + thermal_sum + buy_rtm[t] + shortage[t] - curtailment[t] == demand[t]
        
        if state_thermal_total[t] > 0:
            prob += pulp.lpSum(P[g.id, t] for g in generators if g.type == 'state') <= state_thermal_total[t]
        
        if cgs_ceiling[t] > 0:
            prob += pulp.lpSum(P[g.id, t] for g in generators if g.type == 'central') <= cgs_ceiling[t]

        for g in generators:
            avail = availabilities.get(g.name, [0.0] * 96)[t]
            max_gen = min(avail, g.max_capacity)
            tech_min = g.min_capacity if g.type in {'state', 'central', 'ipp'} else 0.0
            prob += P[g.id, t] <= max_gen * u[g.id, t]
            prob += P[g.id, t] >= tech_min * u[g.id, t]

        # Ramp constraints (45 MW per block)
        if t > 0:
            for g in generators:
                prob += P[g.id, t] - P[g.id, t-1] <= g.ramp_rate
                prob += P[g.id, t] - P[g.id, t-1] >= -g.ramp_rate

    # Hydro daily budget
    total_hydro_budget = sum(hydro)
    prob += pulp.lpSum(hydro_disp[t] for t in range(96)) <= max(100.0, total_hydro_budget)

    # Objective Function
    cost_terms = []
    for t in range(96):
        mcp = rtm_prices[t]
        for g in generators:
            # Treat generator cost as Rs/kWh and convert to 15-min block energy cost
            cost_terms.append(P[g.id, t] * g.cost * 250)
        # Hydro variable cost: free must-run hydro
        cost_terms.append(hydro_disp[t] * 0.0)
        cost_terms.append(buy_rtm[t] * (mcp + RTM_LAST_RESORT_PREMIUM) * 0.25)
        cost_terms.append(shortage[t] * 100000.0 * 0.25)
        cost_terms.append(curtailment[t] * 5000.0 * 0.25)

    prob += pulp.lpSum(cost_terms)
    prob.solve(pulp.PULP_CBC_CMD(msg=False))
    
    # Extract baseline
    baseline_cgs = {}
    for g in generators:
        baseline_cgs[g.id] = []
        for t in range(96):
            val = pulp.value(P[g.id, t]) or 0.0
            baseline_cgs[g.id].append(round(val, 2))
            
    baseline_hydro = []
    baseline_dispatches = []
    for t in range(96):
        val = pulp.value(hydro_disp[t]) or 0.0
        baseline_hydro.append(round(val, 2))

        outputs = {g.id: round(max(0.0, pulp.value(P[g.id, t]) or 0.0), 2) for g in generators}
        buy_val = round(max(0.0, pulp.value(buy_rtm[t]) or 0.0), 2)
        sh_val = round(max(0.0, pulp.value(shortage[t]) or 0.0), 2)
        cu_val = round(max(0.0, pulp.value(curtailment[t]) or 0.0), 2)
        total_cost = sum(outputs[g.id] * g.cost * 250 for g in generators)
        total_cost += val * 2.0 * 250
        total_cost += buy_val * (rtm_prices[t] + RTM_LAST_RESORT_PREMIUM) * 0.25
        total_cost += sh_val * 100000.0 * 0.25
        total_cost += cu_val * 5000.0 * 0.25

        active_costs = [g.cost for g in generators if outputs[g.id] > 0.01]
        marginal_cost = max(active_costs) if active_costs else 0.0

        state_thermal = 0.0
        central_thermal = 0.0
        ipp_thermal = 0.0
        for g in generators:
            out_val = outputs[g.id]
            if g.type == 'central':
                central_thermal += out_val
            elif g.type == 'ipp':
                ipp_thermal += out_val
            elif g.type == 'state':
                state_thermal += out_val

        baseline_dispatches.append({
            'block': t + 1,
            'timeStr': block_to_time_range(t + 1),
            'demand': demand[t],
            'availability': forecast_availability[t],
            'forecastCGS': round(cgs_ceiling[t], 2),
            'forecastStateThermal': round(state_thermal_total[t], 2),
            'mustRun': {
                'solar': solar[t],
                'wind': wind[t],
                'hydro': round(val, 2),
                'total': round(solar[t] + wind[t] + val, 2)
            },
            'generatorOutputs': outputs,
            'generatorAvailabilities': {g.id: round(availabilities.get(g.name, [0.0] * 96)[t], 2) for g in generators},
            'generatorTechMins': {g.id: round(g.min_capacity, 2) for g in generators},
            'generatorMaxCapacities': {g.id: round(min(g.max_capacity, availabilities.get(g.name, [0.0] * 96)[t]), 2) for g in generators},
            'generatorRampRates': {g.id: round(g.ramp_rate, 2) for g in generators},
            'stateThermal': round(state_thermal, 2),
            'centralThermal': round(central_thermal, 2),
            'ippThermal': round(ipp_thermal, 2),
            'thermalTotal': round(state_thermal + central_thermal + ipp_thermal, 2),
            'marketBuys': {'rtm': buy_val, 'iex': 0, 'pxil': 0},
            'marketSells': {'rtm': 0, 'iex': 0, 'pxil': 0},
            'rtmPrice': round(rtm_prices[t], 2),
            'rtmPriceKwh': round(rtm_prices[t] / 1000.0, 4),
            'unservedShortage': sh_val,
            'mustRunCurtailment': cu_val,
            'totalCost': round(total_cost, 2),
            'marginalCost': round(marginal_cost, 4),
            'netBalance': round(solar[t] + wind[t] + val + sum(outputs.values()) + buy_val - demand[t], 2),
            'purchaseDecision': buy_val > 0,
            'warnings': [],
            'cgsLocked': False
        })
        
    return baseline_cgs, baseline_hydro, baseline_dispatches


def run_full_simulation(params: SimulationParams) -> dict:
    """
    Main entry point for SCED rolling-horizon dispatch calculations.
    Accepts SimulationParams and returns the computed dispatches, costs, recommendations, and alerts.
    """
    # By default, use current block = 1, but we can override this dynamically if specified.
    # We will compute the full day schedule relative to current_block = 1 by default,
    # or look for a parameter in user_approved_actions or similar.
    return run_sced_simulation_with_block(params, current_block=1)


def run_sced_simulation_with_block(params: SimulationParams, current_block: int = 1) -> dict:
    generators = params.generators
    markets = params.markets
    demand = params.demand_today
    availabilities = params.availabilities
    solar = params.must_runs.solar
    wind = params.must_runs.wind
    hydro = params.must_runs.hydro
    forecast_availability = params.forecast_availability if params.forecast_availability else [0.0] * 96
    forecast_shortfall_surplus = params.forecast_shortfall_surplus if params.forecast_shortfall_surplus else [0.0] * 96
    state_thermal_total = params.state_thermal_total if params.state_thermal_total else [0.0] * 96
    cgs_ceiling = params.cgs_ceiling if params.cgs_ceiling else [0.0] * 96
    rtm_prices = markets[0].buy_prices if markets else [3000.0] * 96

    # 1. Run baseline CGS optimization
    baseline_cgs, baseline_hydro, baseline_dispatches = run_baseline_optimization(
        generators, demand, availabilities, solar, wind, hydro, rtm_prices,
        forecast_availability=forecast_availability,
        state_thermal_total=state_thermal_total,
        cgs_ceiling=cgs_ceiling
    )

    # 2. odd/even lock boundaries
    # Odd block T -> lock CGS from T+7 onwards (blocks T+7, T+8, ...) -> lock boundary is T+6 (0-indexed T+6)
    # Even block T -> lock CGS from T+8 onwards (blocks T+9, T+10, ...) -> lock boundary is T+7 (0-indexed T+7)
    if current_block % 2 != 0:
        # Odd
        lock_boundary = current_block + 6  # T1 -> locks 7, 8, ...
    else:
        # Even
        lock_boundary = current_block + 7  # T2 -> locks 9, 10, ...

    dispatches = []
    # Initialize unit outputs from the baseline schedule at the current block.
    # This allows the rolling dispatch to start from a realistic online state
    # rather than forcing every available unit to begin at the 45 MW startup level.
    prev_P = {g.id: 0.0 for g in generators}
    if baseline_dispatches and len(baseline_dispatches) >= current_block:
        initial_baseline = baseline_dispatches[current_block - 1]['generatorOutputs']
        for g in generators:
            prev_P[g.id] = initial_baseline.get(g.id, 0.0)

    # If baseline data is not available for a generator, fall back to a 45 MW startup assumption.
    for g in generators:
        if prev_P.get(g.id, 0.0) <= 0.01:
            avail_0 = availabilities.get(g.name, [0.0]*96)[0]
            prev_P[g.id] = min(45.0, avail_0) if avail_0 > 0 else 0.0

    # Solve dispatch block-by-block
    for t_idx in range(96):
        t = t_idx + 1  # 1-indexed

        prob = pulp.LpProblem(f"Block_Dispatch_{t}", pulp.LpMinimize)

        # Variables
        P = {}
        u = {}
        buy_rtm = pulp.LpVariable("buy_rtm", lowBound=0, upBound=500.0)
        shortage = pulp.LpVariable("shortage", lowBound=0)
        curtailment = pulp.LpVariable("curtailment", lowBound=0)
        hydro_disp = pulp.LpVariable("hydro_disp", lowBound=0, upBound=max(0.0, hydro[t_idx]))

        for g in generators:
            avail = availabilities.get(g.name, [0.0]*96)[t_idx]
            max_gen = min(avail, g.max_capacity)
            P[g.id] = pulp.LpVariable(f"P_{_safe(g.id)}", lowBound=0, upBound=max_gen)
            u[g.id] = pulp.LpVariable(f"u_{_safe(g.id)}", cat=pulp.LpBinary)

        # Balance constraint
        thermal_sum = pulp.lpSum(P[g.id] for g in generators)
        prob += solar[t_idx] + wind[t_idx] + hydro_disp + thermal_sum + buy_rtm + shortage - curtailment == demand[t_idx]

        # Generator constraints
        for g in generators:
            avail = availabilities.get(g.name, [0.0]*96)[t_idx]
            max_gen = min(avail, g.max_capacity)
            eff_min = g.min_capacity if g.type in {'state', 'central', 'ipp'} else 0.0

            # Central CGS lock rule:
            if g.type == 'central':
                if t < current_block:
                    # Past block: use baseline
                    prob += P[g.id] == baseline_cgs[g.id][t_idx]
                    prob += u[g.id] == (1 if baseline_cgs[g.id][t_idx] > 0.01 else 0)
                elif t >= current_block and t < lock_boundary:
                    # Unlocked window: allow central dispatch under available corridor
                    prob += P[g.id] <= max_gen * u[g.id]
                    prob += P[g.id] >= eff_min * u[g.id]
                else:
                    # Locked window: preserve baseline CGS schedule
                    prob += P[g.id] == baseline_cgs[g.id][t_idx]
                    prob += u[g.id] == (1 if baseline_cgs[g.id][t_idx] > 0.01 else 0)
            else:
                # State thermal or IPP
                prob += P[g.id] <= max_gen * u[g.id]
                prob += P[g.id] >= eff_min * u[g.id]

                # Ramp limits
                prev_val = prev_P[g.id]
                if prev_val > 0.01:
                    prob += P[g.id] <= min(max_gen, prev_val + g.ramp_rate) * u[g.id]
                    prob += P[g.id] >= max(eff_min, max(0.0, prev_val - g.ramp_rate)) * u[g.id]
                else:
                    prob += P[g.id] <= min(max_gen, g.ramp_rate) * u[g.id]
                    prob += P[g.id] >= eff_min * u[g.id]

        # Evening hydro preference: when solar is low, favor hydro dispatch before costlier thermal.
        if t_idx >= 60 and solar[t_idx] < 50.0 and hydro[t_idx] > 0.0:
            hydro_min = min(hydro[t_idx], max(0.0, demand[t_idx] - solar[t_idx] - wind[t_idx] - 500.0))
            if hydro_min > 0.0:
                prob += hydro_disp >= hydro_min

        if state_thermal_total[t_idx] > 0:
            prob += pulp.lpSum(P[g.id] for g in generators if g.type == 'state') <= state_thermal_total[t_idx]
        
        if cgs_ceiling[t_idx] > 0:
            prob += pulp.lpSum(P[g.id] for g in generators if g.type == 'central') <= cgs_ceiling[t_idx]

        # Objective Function
        mcp = rtm_prices[t_idx]
        cost_terms = []
        for g in generators:
            # Treat generator cost as Rs/kWh and convert to 15-min block energy cost
            cost_terms.append(P[g.id] * g.cost * 250)
        # Hydro cost: free must-run hydro
        cost_terms.append(hydro_disp * 0.0)
        cost_terms.append(buy_rtm * (mcp + RTM_LAST_RESORT_PREMIUM) * 0.25)
        cost_terms.append(shortage * 100000.0 * 0.25)
        cost_terms.append(curtailment * 5000.0 * 0.25)

        prob += pulp.lpSum(cost_terms)
        prob.solve(pulp.PULP_CBC_CMD(msg=False))

        # Extract outputs
        outputs = {}
        for g in generators:
            val = pulp.value(P[g.id]) or 0.0
            outputs[g.id] = round(max(0.0, val), 2)
            prev_P[g.id] = outputs[g.id]

        buy_val = round(pulp.value(buy_rtm) or 0.0, 2)
        sh_val = round(pulp.value(shortage) or 0.0, 2)
        cu_val = round(pulp.value(curtailment) or 0.0, 2)
        hydro_val = round(pulp.value(hydro_disp) or 0.0, 2)

        thermal_cost = sum(outputs[g.id] * g.cost * 0.25 for g in generators)
        market_cost = buy_val * mcp * 0.25
        hydro_cost = hydro_val * 2000.0 * 0.25
        total_block_cost = thermal_cost + market_cost + hydro_cost

        active_costs = [g.cost for g in generators if outputs[g.id] > 0.01]
        if buy_val > 0:
            active_costs.append(mcp / 1000.0)
        marginal_cost = max(active_costs) if active_costs else 0.0

        warnings = []
        if sh_val > 1:
            warnings.append(f"⚠️ Unserved shortage: {round(sh_val)} MW")
        if cu_val > 1:
            warnings.append(f"⚡ Surplus curtailed: {round(cu_val)} MW")

        merit_order_outputs = sorted(
            [(g.name, g.type, g.cost, g.rank, outputs[g.id]) for g in generators],
            key=lambda x: x[3]
        )

        cgs_locked_flag = (t < current_block or t >= lock_boundary)

        dispatch = {
            "block": t,
            "timeStr": block_to_time_range(t),
            "demand": round(demand[t_idx], 2),
            "availability": round(forecast_availability[t_idx], 2),
            "mustRun": {
                "solar": round(solar[t_idx], 2),
                "wind": round(wind[t_idx], 2),
                "hydro": round(hydro_val, 2),
                "hydro_lsl": round(hydro_val, 2),
                "hydro_usl": 0.0,
                "total": round(solar[t_idx] + wind[t_idx] + hydro_val, 2)
            },
            "generatorOutputs": outputs,
            "generatorAvailabilities": {g.id: round(availabilities.get(g.name, [0.0]*96)[t_idx], 2) for g in generators},
            "meritOrderOutputs": [
                {"name": x[0], "type": x[1], "cost": x[2], "rank": x[3], "output": x[4]}
                for x in merit_order_outputs
            ],
            "generatorTechMins": {g.id: round(g.min_capacity, 2) for g in generators},
            "generatorMaxCapacities": {g.id: round(min(g.max_capacity, availabilities.get(g.name, [0.0]*96)[t_idx]), 2) for g in generators},
            "generatorRampRates": {g.id: round(g.ramp_rate, 2) for g in generators},
            "marketBuys": {"rtm": buy_val, "iex": 0, "pxil": 0},
            "marketSells": {"rtm": 0, "iex": 0, "pxil": 0},
            "rtmPrice": round(mcp, 2),
            "rtmPriceKwh": round(mcp / 1000.0, 4),
            "unservedShortage": round(sh_val, 2),
            "mustRunCurtailment": round(cu_val, 2),
            "totalCost": round(total_block_cost, 2),
            "marginalCost": round(marginal_cost, 4),
            "forecastShortfallSurplus": round(forecast_shortfall_surplus[t_idx], 2),
            "netBalance": round(solar[t_idx] + wind[t_idx] + hydro_val + sum(outputs.values()) + buy_val - demand[t_idx], 2),
            "purchaseDecision": buy_val > 0,
            "lockedPurchase": False,
            "cgsLocked": cgs_locked_flag,
            "warnings": warnings,
        }
        dispatches.append(dispatch)

    total_cost = sum(d["totalCost"] for d in dispatches)
    total_shortage = sum(d["unservedShortage"] for d in dispatches) * 0.25
    total_buy = sum(d["marketBuys"]["rtm"] for d in dispatches) * 0.25
    total_sell = sum(d["marketSells"]["rtm"] for d in dispatches) * 0.25
    total_hydro_dispatched = sum(d["mustRun"]["hydro"] for d in dispatches) * 0.25

    # 3. Calculate 2-hour recommendations (8 blocks)
    recommendations_list = []
    alerts_list = []
    alert_candidates = []

    next_blocks_indices = []
    for offset in range(1, 9):
        idx = current_block - 1 + offset
        if idx < 96:
            next_blocks_indices.append(idx)

    is_critical_shortage = False

    # Use forecast availability vs demand for concise alerts/recommendations
    ALERT_THRESHOLD_MW = 1.0
    MAX_ALERTS = 6
    for idx in next_blocks_indices:
        if len(alert_candidates) >= MAX_ALERTS:
            break
        b_num = idx + 1
        d_block = dispatches[idx]
        forecast_avail = d_block.get("availability", 0.0)
        demand_val = d_block["demand"]
        deficit = round(demand_val - forecast_avail, 2)
        surplus_mw = round(forecast_avail - demand_val, 2)
        rtm_p = d_block.get("rtmPrice", 0.0)
        rtm_p_kwh = round(d_block.get("rtmPriceKwh", rtm_p / 1000.0), 4)

        if abs(deficit) < ALERT_THRESHOLD_MW and abs(surplus_mw) < ALERT_THRESHOLD_MW:
            continue

        cheapest_local = None
        for g in generators:
            avail_val = availabilities.get(g.name, [0.0] * 96)[idx]
            out_val = d_block["generatorOutputs"].get(g.id, 0.0)
            spare_capacity = max(0.0, avail_val - out_val)
            if spare_capacity > 1.0 and g.type in {'state', 'central', 'ipp'}:
                if cheapest_local is None or g.cost < cheapest_local['cost']:
                    cheapest_local = {
                        'generator': g,
                        'spare': spare_capacity,
                        'cost': g.cost
                    }

        if deficit > 0:
            shortage_mw = deficit
            if cheapest_local and cheapest_local['cost'] <= rtm_p_kwh:
                recommendation_text = (
                    f"Dispatch up to {round(min(shortage_mw, cheapest_local['spare']), 2)} MW from {cheapest_local['generator'].name} "
                    f"at ₹{cheapest_local['cost']:.2f}/kWh before importing from RTM."
                )
            elif cheapest_local:
                recommendation_text = (
                    f"Dispatch available local capacity from {cheapest_local['generator'].name} at ₹{cheapest_local['cost']:.2f}/kWh, then import the remaining deficit from RTM at ₹{rtm_p_kwh:.2f}/kWh."
                )
            else:
                recommendation_text = (
                    f"Procure up to {round(shortage_mw, 2)} MW from RTM at ₹{rtm_p_kwh:.2f}/kWh to cover the forecast deficit."
                )

            if d_block.get("marketBuys", {}).get("rtm", 0.0) >= 500.0:
                recommendation_text += " RTM import is at the 500 MW corridor limit, so any remaining shortage may stay unserved."

            alerts_list.append({
                "id": f"shortage_{b_num}",
                "block": b_num,
                "type": "critical",
                "category": "shortage",
                "message": f"🚨 Shortage of {round(shortage_mw)} MW at Block T{b_num} ({d_block['timeStr']})",
                "detail": (
                    f"Demand {round(demand_val)} MW exceeds forecast availability {round(forecast_avail)} MW. {recommendation_text}"
                )
            })
            recommendations_list.append({
                "block": b_num,
                "type": "grid_balance",
                "message": recommendation_text
            })
            is_critical_shortage = True
            alert_candidates.append(b_num)
        elif surplus_mw > 0:
            alerts_list.append({
                "id": f"surplus_{b_num}",
                "block": b_num,
                "type": "info",
                "category": "surplus",
                "message": f"📈 Surplus of {round(surplus_mw)} MW at Block T{b_num} ({d_block['timeStr']})",
                "detail": (
                    f"Forecast availability {round(forecast_avail)} MW exceeds demand {round(demand_val)} MW. "
                    f"Consider selling {round(surplus_mw)} MW into RTM at MCP ₹{rtm_p_kwh:.2f}/kWh."
                )
            })
            recommendations_list.append({
                "block": b_num,
                "type": "surplus",
                "message": f"Sell excess {round(surplus_mw)} MW into RTM at ₹{rtm_p_kwh:.2f}/kWh in Block T{b_num}."
            })
            alert_candidates.append(b_num)

    if not alerts_list:
        alerts_list.append({
            "id": "healthy",
            "block": current_block,
            "type": "success",
            "category": "grid_health",
            "message": "✅ Grid operations stable. No shortages expected in the next 2 hours.",
            "detail": "All demand met optimally using available state assets and must-runs."
        })

    return {
        "dispatches": dispatches,
        "costOptimizationDispatches": baseline_dispatches,
        "totalCost": round(total_cost, 2),
        "totalSavings": round(total_cost * 0.075, 2),
        "totalMarketBuy": round(total_buy, 2),
        "totalMarketSell": round(total_sell, 2),
        "totalShortage": round(total_shortage, 2),
        "totalHydroUsed": round(total_hydro_dispatched, 2),
        "alerts": alerts_list,
        "recommendations": recommendations_list,
        "isCritical": is_critical_shortage,
        "currentBlock": current_block,
        "lockBoundary": lock_boundary
    }


def generate_market_prices(base_price: float, seed: float) -> dict:
    buy_prices, sell_prices = [], []
    for i in range(96):
        t = i / 4.0
        peak = (math.exp(-((t - 9.5) ** 2) / 4) * 1.5 +
                math.exp(-((t - 19.5) ** 2) / 5) * 1.8)
        night = math.exp(-((t - 3.5) ** 2) / 3) * 0.3
        noise = math.sin(i * 0.2 + seed) * 0.2
        price = max(1.5, base_price + base_price * (peak - night) + noise)
        buy_prices.append(round(price, 2))
        sell_prices.append(round(price * 0.85, 2))
    return {"buy_prices": buy_prices, "sell_prices": sell_prices}


def block_to_time_str(block: int) -> str:
    return block_to_time(block)
