"""
TRANSCO SCED FastAPI Backend — main.py
Serves real optimization results from forecast.db via HTTP API.
"""

import os
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime

from database import (
    engine, SessionLocal, create_tables, get_db,
    GeneratorDB, MarketDB, AlertDB,
    load_raw_generators, load_raw_forecast,
    load_raw_availabilities, load_raw_prices,
    FORECAST_DB_PATH
)
from optimizer import (
    run_full_simulation, run_sced_simulation_with_block, Generator, Market, WeatherEvent,
    MustRunForecast, SimulationParams, generate_market_prices
)

app = FastAPI(title="TRANSCO SCED Co-pilot API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Startup ──────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup_event():
    create_tables()
    db = SessionLocal()
    try:
        # Seed generators from forecast.db if table is empty
        if db.query(GeneratorDB).count() == 0:
            raw_gens = load_raw_generators()
            for g in raw_gens:
                db.add(GeneratorDB(
                    id=g["id"], name=g["name"], type=g["type"],
                    cost=g["cost"], min_capacity=0.0, max_capacity=0.0,
                    ramp_rate=45.0, fuel_type="coal", is_active=True
                ))
            db.commit()
            print(f"Seeded {len(raw_gens)} generators from forecast.db")

        if db.query(MarketDB).count() == 0:
            db.add(MarketDB(id='rtm', name='Real-Time Market (RTM)', max_capacity=500.0))
            db.add(MarketDB(id='iex', name='IEX Day-Ahead Market', max_capacity=300.0))
            db.commit()
    finally:
        db.close()


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    db_exists = os.path.exists(FORECAST_DB_PATH)
    return {
        "status": "healthy",
        "forecast_db_connected": db_exists,
        "timestamp": datetime.utcnow().isoformat()
    }


# ── Generator Data ────────────────────────────────────────────────────────────

@app.get("/api/generators")
def get_generators():
    """Returns all generators loaded from forecast.db with type classification."""
    raw = load_raw_generators()
    avail = load_raw_availabilities()

    result = []
    for g in raw:
        gen_avail = avail.get(g["name"], [0.0] * 96)
        max_cap = max(gen_avail) if gen_avail else 0.0

        # Tech min
        from optimizer import get_tech_min
        tech_min = get_tech_min(g["name"], max_cap)

        result.append({
            "id": g["id"],
            "name": g["name"],
            "type": g["type"],
            "cost": g["cost"],
            "rank": g["rank"],
            "maxCapacity": max_cap,
            "minCapacity": tech_min,
            "rampRate": 45.0,
            "currentAvailability": gen_avail[0]
        })

    return sorted(result, key=lambda x: (x["rank"], x["cost"], x["name"]))


# ── Forecast Data ─────────────────────────────────────────────────────────────

@app.get("/api/forecast")
def get_forecast():
    """Returns 96-block forecast: demand, solar, wind, hydro from forecast.db."""
    fc = load_raw_forecast()
    prices = load_raw_prices()
    if not fc:
        raise HTTPException(status_code=503, detail="Forecast database unavailable")

    blocks = []
    for i in range(96):
        from optimizer import block_to_time, block_to_time_range
        blocks.append({
            "block": i + 1,
            "timeStr": block_to_time_range(i + 1),
            "demand": fc["demand"][i],
            "availability": fc.get("availability", [0.0] * 96)[i],
            "solar": fc["solar"][i],
            "wind": fc["wind"][i],
            "hydro": fc["hydro"][i],
            "rtmPrice": prices[i]
        })
    return {"blocks": blocks, "date": "28/05/2026"}


# ── Market Prices ─────────────────────────────────────────────────────────────

@app.get("/api/market-prices")
def get_market_prices():
    """Returns 96-block RTM MCP prices from forecast.db."""
    prices = load_raw_prices()
    return [{"block": i+1, "mcp": prices[i]} for i in range(96)]


# ── Main Simulation Endpoint ──────────────────────────────────────────────────

@app.post("/api/simulation/run")
def run_simulation(params_override: dict = None):
    """
    Run the rolling-horizon SCED simulation using real data from forecast.db.
    Optional overrides: generator cost adjustments, corridor limits, weather events.
    """
    if params_override is None:
        params_override = {}

    # Load real data
    raw_gens = load_raw_generators()
    fc = load_raw_forecast()
    avail = load_raw_availabilities()
    rtm_prices = load_raw_prices()

    if not raw_gens or not fc or not avail:
        raise HTTPException(status_code=503, detail="Forecast database unavailable or empty")

    # Apply generator overrides if provided
    cost_overrides = {g.get("name", ""): g.get("cost") for g in params_override.get("generators", []) if g.get("cost") is not None}
    min_cap_overrides = {g.get("name", ""): g.get("minCapacity") for g in params_override.get("generators", []) if g.get("minCapacity") is not None}
    max_cap_overrides = {g.get("name", ""): g.get("maxCapacity") for g in params_override.get("generators", []) if g.get("maxCapacity") is not None}
    ramp_overrides = {g.get("name", ""): g.get("rampRate") for g in params_override.get("generators", []) if g.get("rampRate") is not None}

    # Build Generator objects from genco__and_ipp availability profiles.
    generators = []
    from optimizer import get_tech_min
    for g in raw_gens:
        gen_avail = avail.get(g["name"], [0.0] * 96)

        max_cap = max_cap_overrides.get(g["name"], max(gen_avail) if gen_avail else 0.0)
        tech_min = min_cap_overrides.get(g["name"], get_tech_min(g["name"], max_cap))
        cost = cost_overrides.get(g["name"], g["cost"])
        ramp_rate = ramp_overrides.get(g["name"], 45.0)

        generators.append(Generator(
            id=g["id"],
            name=g["name"],
            type=g["type"],
            cost=cost,
            max_capacity=max_cap,
            min_capacity=tech_min,
            ramp_rate=ramp_rate,
            rank=g.get("rank", 99),
            bd_col=g.get("bd_col", "")
        ))

    # Sort by merit order using rank and cost from the real database
    generators.sort(key=lambda x: (x.rank, x.cost, x.name))

    # Corridor limit override
    rtm_corridor = params_override.get("rtmCorridorMW", 500)

    # Build Market objects
    markets = [
        Market(
            id="rtm", name="Real-Time Market (RTM)",
            max_capacity=rtm_corridor,
            buy_prices=rtm_prices,
            sell_prices=[p * 0.85 for p in rtm_prices]
        )
    ]

    # Build must-run forecast (allow override of mustRuns arrays)
    override_must_runs = params_override.get("mustRuns", {})
    must_runs = MustRunForecast(
        solar=override_must_runs.get("solar", fc["solar"]),
        wind=override_must_runs.get("wind", fc["wind"]),
        hydro=override_must_runs.get("hydro", fc["hydro"]),
        ipp=override_must_runs.get("ipp", [0.0] * 96)
    )

    # Weather events from override
    weather_events = [
        WeatherEvent(
            block=w.get("block", 1),
            severity=w.get("severity", 0.5),
            type=w.get("type", "cloud"),
            duration_blocks=w.get("durationBlocks", 4)
        ) for w in params_override.get("weatherEvents", [])
    ]

    approved = params_override.get("userApprovedActions", {})
    rejected = params_override.get("userRejectedActions", {})

    # Build availabilities dict keyed by generator name
    gen_avail_by_name = {}
    for g in generators:
        if g.name in avail:
            gen_avail_by_name[g.name] = [min(v, g.max_capacity) for v in avail[g.name]]
        else:
            gen_avail_by_name[g.name] = [g.max_capacity] * 96

    sim_params = SimulationParams(
        generators=generators,
        markets=markets,
        demand_yesterday=fc["demand"],   # Same for now, can be overridden
        demand_today=fc["demand"],
        must_runs=must_runs,
        availabilities=gen_avail_by_name,
        forecast_availability=fc.get("availability", [0.0] * 96),
        forecast_shortfall_surplus=fc.get("shortfall_surplus", [0.0] * 96),
        weather_events=weather_events,
        user_approved_actions=approved,
        user_rejected_actions=rejected
    )

    current_block = params_override.get("currentBlock", 1)
    result = run_sced_simulation_with_block(sim_params, current_block=current_block)

    # Attach generator metadata for frontend
    result["generators"] = [
        {"id": g.id, "name": g.name, "type": g.type, "cost": g.cost, "rank": g.rank,
         "maxCapacity": g.max_capacity, "minCapacity": g.min_capacity, "rampRate": g.ramp_rate}
        for g in generators
    ]
    result["forecast"] = {
        "demand": fc["demand"], "solar": fc["solar"],
        "wind": fc["wind"], "hydro": fc["hydro"],
        "availability": fc.get("availability", [0.0] * 96),
        "shortfallSurplus": fc.get("shortfall_surplus", [0.0] * 96),
        "rtmPrices": rtm_prices
    }
    return result


# ── Alert Actions ─────────────────────────────────────────────────────────────

@app.post("/api/alerts/action")
def record_alert_action(action_data: dict, db: Session = Depends(get_db)):
    alert_id = action_data.get("alertId")
    action = action_data.get("action")
    if not alert_id or action not in ["approve", "reject"]:
        raise HTTPException(status_code=400, detail="Bad request: missing alertId or action")

    db_alert = db.query(AlertDB).filter(AlertDB.id == alert_id).first()
    if not db_alert:
        db_alert = AlertDB(
            id=alert_id,
            date=datetime.utcnow().strftime("%Y-%m-%d"),
            block=action_data.get("block", 1),
            alert_type="critical",
            category="weather"
        )
        db.add(db_alert)

    db_alert.approved = (action == "approve")
    db_alert.rejected = (action == "reject")
    db_alert.resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(db_alert)
    return {"success": True, "alertId": alert_id, "action": action}


@app.get("/api/alerts")
def get_alerts(db: Session = Depends(get_db)):
    alerts = db.query(AlertDB).order_by(AlertDB.created_at.desc()).limit(100).all()
    return alerts


# ── Helpers ───────────────────────────────────────────────────────────────────

