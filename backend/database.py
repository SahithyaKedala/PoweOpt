"""
TRANSCO SCED — database.py
Uses forecast .db ONLY (the 14 real tables).
All SQLAlchemy app-tables (generators, markets, dispatch_blocks, alerts, excel_uploads)
are stored in the SAME forecast .db but NEVER pollute the 14 real tables.
On startup, any legacy extra tables added by older code are removed.
"""

import os
import sqlite3
import difflib
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, Float, String, Boolean, DateTime, JSON, Text
from sqlalchemy.orm import declarative_base, sessionmaker

# ── Locate forecast .db ──────────────────────────────────────────────────────
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_DIR = os.path.dirname(_BACKEND_DIR)

_candidate_paths = [
    os.path.join(_PROJECT_DIR, "src", "LGB.db"),
    os.path.join(_PROJECT_DIR, "LGB.db"),
    os.path.join(_PROJECT_DIR, "forecast .db"),
    os.path.join(_PROJECT_DIR, "forecast.db"),
    r"c:\Users\sc\Downloads\LGB_AGENTIC\src\LGB.db",
    r"c:\Users\sc\Downloads\LGB_AGENTIC\LGB.db",
]

FORECAST_DB_PATH = None
for _p in _candidate_paths:
    if os.path.exists(_p):
        FORECAST_DB_PATH = _p
        break
if not FORECAST_DB_PATH:
    FORECAST_DB_PATH = os.path.join(_PROJECT_DIR, "src", "LGB.db")

print(f"[database.py] Using database: {FORECAST_DB_PATH}")

# ── REAL tables we must NEVER drop ─────────────────────────────────────────
REAL_TABLES = {
    'BD_QUANTUM', 'Calculation', 'Forecast', 'GEN_MASTER',
    'KPMG_FC', 'MERIT_MAP', 'MERIT_ORDER', 'P_OPT_Data',
    'P_OPT_Upload', 'Scada_Daily_Report', 'Shortfall_Surplus',
    'Solar_DSM', 'Wind_DSM', 'market_prices'
}

# SQLAlchemy also uses forecast .db (safe — it only creates missing tables)
DATABASE_URL = f"sqlite:///{FORECAST_DB_PATH}"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False, "timeout": 30})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ── SQLAlchemy ORM models (app-level, stored in forecast .db) ───────────────

class GeneratorDB(Base):
    __tablename__ = "generators"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)
    cost = Column(Float, nullable=False)
    min_capacity = Column(Float, nullable=False)
    max_capacity = Column(Float, nullable=False)
    ramp_rate = Column(Float, nullable=False)
    fuel_type = Column(String, default="coal")
    plant = Column(String, default="")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MarketDB(Base):
    __tablename__ = "markets"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    max_capacity = Column(Float, nullable=False)
    is_active = Column(Boolean, default=True)


class DispatchBlockDB(Base):
    __tablename__ = "dispatch_blocks"
    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(String, nullable=False)
    block = Column(Integer, nullable=False)
    time_str = Column(String)
    demand = Column(Float)
    solar = Column(Float)
    wind = Column(Float)
    hydro = Column(Float)
    thermal_total = Column(Float)
    market_buy_rtm = Column(Float, default=0)
    unserved_shortage = Column(Float, default=0)
    total_cost = Column(Float)
    generator_outputs = Column(JSON)
    warnings = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)


class AlertDB(Base):
    __tablename__ = "alerts"
    id = Column(String, primary_key=True)
    date = Column(String, nullable=False)
    block = Column(Integer, nullable=False)
    alert_type = Column(String)
    category = Column(String)
    message = Column(Text)
    detail = Column(Text)
    action_required = Column(Boolean, default=False)
    approved = Column(Boolean, default=False)
    rejected = Column(Boolean, default=False)
    action_details = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime)


class ExcelUploadDB(Base):
    __tablename__ = "excel_uploads"
    id = Column(Integer, primary_key=True, autoincrement=True)
    filename = Column(String)
    upload_date = Column(DateTime, default=datetime.utcnow)
    record_count = Column(Integer)
    status = Column(String, default="pending")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    """Create app-level tables in the connected database without modifying source data tables."""
    Base.metadata.create_all(bind=engine)


def _cleanup_extra_tables():
    """No-op cleanup: do not delete tables from the source database."""
    return


# ── Raw SQLite helpers (query the 14 real tables) ───────────────────────────

def _conn():
    return sqlite3.connect(FORECAST_DB_PATH)


def format_db_time(t_str):
    if not t_str:
        return ""
    parts = str(t_str).split(":")
    if len(parts) >= 2:
        return f"{parts[0]}:{parts[1]}"
    return str(t_str)


# ── Generator catalogue from MERIT_MAP + BD_QUANTUM capacities ──────────────
#
# MERIT_MAP has: Gen, Price, Rank, ColNo
# BD_QUANTUM columns match MERIT_MAP.Gen names (stripped of \n, spaces normalised)
# We build a mapping: BD_QUANTUM column index = MERIT_MAP.ColNo (1-indexed, column 0 = Block)

def _slugify(text: str) -> str:
    if not text:
        return ""
    text = str(text).strip().lower()
    result = []
    for ch in text:
        if ch.isalnum():
            result.append(ch)
        else:
            result.append('_')
    return '_'.join(''.join(result).split('_')).strip('_')


def _normalize_name(value: str) -> str:
    if not value:
        return ''
    normalized = str(value).lower().replace('\n', ' ').replace('\r', ' ')
    normalized = normalized.replace('-', ' ').replace('_', ' ').replace('/', ' ')
    return ' '.join(normalized.split())


def _normalize_key(value: str) -> str:
    if not value:
        return ''
    return ''.join(ch for ch in str(value).lower() if ch.isalnum())


def _load_merit_map(cur):
    merit = {}
    try:
        cur.execute('SELECT Gen, Price, [Rank] FROM [MERIT_MAP]')
        for row in cur.fetchall():
            gen_name = row[0]
            if gen_name is None:
                continue
            key = _normalize_key(gen_name)
            merit[key] = {
                'name': _normalize_name(gen_name),
                'cost': float(row[1]) if row[1] not in (None, '', '#REF!') else 0.0,
                'rank': int(row[2]) if row[2] not in (None, '') else 99
            }
    except Exception:
        pass
    return merit


def _load_merit_order(cur):
    """
    Load MERIT_ORDER table which may contain definitive merit rank and price.
    Returns a dict keyed by normalized generator name with cost and rank.
    """
    merit = {}
    try:
        cur.execute("SELECT [Merit#], Gen, Price, ColNo FROM [MERIT_ORDER]")
        for row in cur.fetchall():
            try:
                rank = int(row[0]) if row[0] not in (None, '') else 99
            except Exception:
                rank = 99
            gen_name = row[1]
            try:
                price = float(row[2]) if row[2] not in (None, '') else 0.0
            except Exception:
                price = 0.0
            if not gen_name:
                continue
            key = _normalize_key(gen_name)
            merit[key] = {
                'name': _normalize_name(gen_name),
                'cost': price,
                'rank': rank
            }
    except Exception:
        pass
    return merit


def _classify_generator_type(name: str) -> str:
    n = _normalize_name(name)
    if 'solar' in n:
        return 'solar'
    if 'wind' in n:
        return 'wind'
    if 'hydel' in n or 'hydro' in n:
        return 'hydro'
    if any(x in n for x in ['gvk', 'spectrum', 'lanco', 'vgts', 'hinduja', 'tpcil', 'seil']):
        return 'ipp'
    if any(x in n for x in ['rtpp', 'kudgi', 'krishnapatnam', 'ntpl', 'nttps', 'nltp', 'simhadri', 'talcher', 'vallur', 'hnpcl', 'rgm', 'nlc', 'tstps', 'tpcil', 'seil']):
        return 'central'
    return 'state'


def _default_cost_for_type(name: str) -> float:
    t = _classify_generator_type(name)
    if t in {'solar', 'wind', 'hydro'}:
        return 2.0
    if t == 'ipp':
        return 4.5
    return 4.0


def _is_generator_header(value: str) -> bool:
    if not value or not isinstance(value, str):
        return False
    v = value.strip()
    if not v or v.lower().startswith('unnamed'):
        return False
    low = v.lower()
    ignore_tokens = [
        'from', 'to', 'total', 'anticipated', 'helper row', 'helper col',
        'margin for outages', 'spinning reserve', 'support', 'surplus after',
        'contingency', 'ap thermal net', 'ap thermal total', 'anticipated deviation',
        'total bd quantity', 'diff between surplus', 'yes = 1', 'no = 0', 'rate',
        'all values are in mw', 'helper'
    ]
    if any(tok in low for tok in ignore_tokens):
        return False
    return any(ch.isalpha() for ch in v)


def load_raw_generators():
    """
    Load generator profiles from genco__and_ipp table and enrich them using MERIT_MAP.
    Returns list of dicts with keys: id, name, type, cost, rank, bd_col, cap_profile
    """
    conn = _conn()
    cur = conn.cursor()
    try:
        merit_map = _load_merit_map(cur)
        # If MERIT_ORDER exists, prefer its values (rank/price) as authoritative
        try:
            merit_order = _load_merit_order(cur)
            # overwrite or extend merit_map with merit_order entries
            for k, v in merit_order.items():
                merit_map[k] = v
        except Exception:
            pass

        try:
            cur.execute("SELECT * FROM [genco__and_ipp]")
        except Exception:
            cur.execute("SELECT * FROM [genco_and_ipp]")
        rows = cur.fetchall()
        if not rows or len(rows) < 2:
            return []

        header = [str(x).strip() if x is not None else '' for x in rows[0]]
        data_rows = rows[1:]

        summary_boundary = len(header)
        for idx, label in enumerate(header):
            low = label.lower()
            if any(token in low for token in [
                'surplus after', 'total bd quantity', 'contingency',
                'margin for outages', 'spinning reserve', 'helper row',
                'helper col', 'yes = 1', 'no = 0'
            ]):
                summary_boundary = idx
                break

        generator_columns = {}
        for idx, label in enumerate(header):
            if idx >= summary_boundary:
                continue
            if _is_generator_header(label):
                generator_columns[idx] = label.strip()

        generators = []
        seen_ids = set()

        for col_idx, name in generator_columns.items():
            profile = []
            for row in data_rows:
                if col_idx >= len(row):
                    profile.append(0.0)
                    continue
                val = row[col_idx]
                try:
                    profile.append(float(val))
                except Exception:
                    profile.append(0.0)
            while len(profile) < 96:
                profile.append(0.0)
            profile = profile[:96]
            if max(profile, default=0.0) <= 0.0:
                continue

            normalized_name = _normalize_name(name)
            normalized_key = _normalize_key(name)
            merit_entry = merit_map.get(normalized_key)
            if merit_entry is None:
                # direct substring match or partial normalized match
                for key, entry in merit_map.items():
                    if key and normalized_key.endswith(key):
                        merit_entry = entry
                        break
                    if key and key.endswith(normalized_key):
                        merit_entry = entry
                        break
                    if key and key in normalized_key:
                        merit_entry = entry
                        break
                if merit_entry is None:
                    close_matches = difflib.get_close_matches(normalized_key, list(merit_map.keys()), n=1, cutoff=0.62)
                    if close_matches:
                        merit_entry = merit_map[close_matches[0]]

            generator_cost = merit_entry['cost'] if merit_entry and merit_entry.get('cost', 0.0) > 0 else _default_cost_for_type(name)
            generator_rank = merit_entry['rank'] if merit_entry and merit_entry.get('rank', 0) > 0 else 99

            base_id = _slugify(name)
            gen_id = base_id
            suffix = 1
            while not gen_id or gen_id in seen_ids:
                gen_id = f"{base_id}_{suffix}" if base_id else f"gen_{col_idx}"
                suffix += 1
            seen_ids.add(gen_id)

            generators.append({
                'id': gen_id,
                'name': name,
                'type': _classify_generator_type(name),
                'cost': round(generator_cost, 4),
                'rank': generator_rank,
                'bd_col': name,
                'cap_profile': profile,
            })

        generators.sort(key=lambda x: (x['rank'], x['cost'], x['name']))
        return generators
    finally:
        conn.close()


def load_raw_forecast():
    """
    Load 96-block forecast from the forecast table in LGB.db.
    The first row contains header labels and data begins from the second row.
    Returns: {demand, solar, wind, hydro, thermal, srisailam, cgs, seil_p1, ipp, time_blocks}
    """
    conn = _conn()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM [forecast]")
        rows = cur.fetchall()
        if not rows or len(rows) < 2:
            return {}

        header = [str(x).strip() if x is not None else '' for x in rows[0]]
        data_rows = rows[1:]

        def _find_header(*terms):
            for idx, label in enumerate(header):
                if not label:
                    continue
                low = label.lower()
                if all(term.lower() in low for term in terms):
                    return idx
            return None

        idx_tb = _find_header('tb')
        idx_demand = _find_header('estimated forecast')
        idx_thermal = _find_header('thermal')
        idx_solar = _find_header('remc solar')
        idx_wind = next((i for i, label in enumerate(header)
                         if label and 'wind' in label.lower() and 'qca' in label.lower()), None)
        idx_hydro = _find_header('hydel')
        idx_srisailam = _find_header('srisailam generation')
        idx_cgs = _find_header('cgs')
        idx_addl = _find_header('addl. generation') or _find_header('addl generation')
        idx_seil_p1 = _find_header('seil p1')
        idx_ipp = _find_header('ipp s including')
        idx_seci = _find_header('seci power')
        idx_stoa = _find_header('stoa purchase')
        idx_swap_from = _find_header('swap from')
        idx_swap_power = _find_header('swap power')
        idx_availability = _find_header('availability')
        idx_shortfall_surplus = _find_header('surplus', 'shortfall')
        idx_start = _find_header('start time')
        idx_end = _find_header('end time') or _find_header('ending time')

        if idx_tb is None or idx_demand is None or idx_solar is None or idx_wind is None or idx_hydro is None:
            print(f"[database.py] Forecast header row did not contain expected labels.")
            print(f"[database.py] Header labels: {header}")
            return {}

        fc = {
            'demand': [0.0] * 96,
            'solar': [0.0] * 96,
            'wind': [0.0] * 96,
            'hydro': [0.0] * 96,
            'thermal': [0.0] * 96,
            'srisailam': [0.0] * 96,
            'cgs': [0.0] * 96,
            'addl': [0.0] * 96,
            'seil_p1': [0.0] * 96,
            'ipp': [0.0] * 96,
            'seci': [0.0] * 96,
            'stoa': [0.0] * 96,
            'swap_from': [0.0] * 96,
            'swap_power': [0.0] * 96,
            'availability': [0.0] * 96,            'shortfall_surplus': [0.0] * 96,            'time_blocks': [''] * 96,
        }

        def _fv(v):
            if v in (None, '', '#REF!'):
                return 0.0
            try:
                return float(v)
            except Exception:
                return 0.0

        for row in data_rows:
            if idx_tb is None or idx_tb >= len(row):
                continue
            tb_raw = row[idx_tb]
            try:
                tb = int(float(tb_raw))
            except Exception:
                continue
            if not (1 <= tb <= 96):
                continue
            i = tb - 1
            fc['demand'][i] = _fv(row[idx_demand]) if idx_demand < len(row) else 0.0
            fc['solar'][i] = _fv(row[idx_solar]) if idx_solar < len(row) else 0.0
            fc['wind'][i] = _fv(row[idx_wind]) if idx_wind is not None and idx_wind < len(row) else 0.0
            fc['hydro'][i] = _fv(row[idx_hydro]) if idx_hydro < len(row) else 0.0
            if idx_start is not None and idx_start < len(row) and idx_end is not None and idx_end < len(row):
                fc['time_blocks'][i] = f"{format_db_time(row[idx_start])}-{format_db_time(row[idx_end])}"
            if idx_srisailam is not None and idx_srisailam < len(row):
                fc['srisailam'][i] = _fv(row[idx_srisailam])
            if idx_cgs is not None and idx_cgs < len(row):
                fc['cgs'][i] = _fv(row[idx_cgs])
            if idx_thermal is not None and idx_thermal < len(row):
                fc['thermal'][i] = _fv(row[idx_thermal])
            if idx_addl is not None and idx_addl < len(row):
                fc['addl'][i] = _fv(row[idx_addl])
            if idx_seil_p1 is not None and idx_seil_p1 < len(row):
                fc['seil_p1'][i] = _fv(row[idx_seil_p1])
            if idx_ipp is not None and idx_ipp < len(row):
                fc['ipp'][i] = _fv(row[idx_ipp])
            if idx_seci is not None and idx_seci < len(row):
                fc['seci'][i] = _fv(row[idx_seci])
            if idx_stoa is not None and idx_stoa < len(row):
                fc['stoa'][i] = _fv(row[idx_stoa])
            if idx_swap_from is not None and idx_swap_from < len(row):
                fc['swap_from'][i] = _fv(row[idx_swap_from])
            if idx_swap_power is not None and idx_swap_power < len(row):
                fc['swap_power'][i] = _fv(row[idx_swap_power])
            if idx_availability is not None and idx_availability < len(row):
                fc['availability'][i] = _fv(row[idx_availability])
            if idx_shortfall_surplus is not None and idx_shortfall_surplus < len(row):
                fc['shortfall_surplus'][i] = _fv(row[idx_shortfall_surplus])
            if idx_ipp is not None and idx_ipp < len(row):
                fc['ipp'][i] = _fv(row[idx_ipp])

        print(f"[database.py] Loaded forecast from LGB.db")
        return fc
    except Exception as e:
        print(f"[database.py] Error loading forecast: {e}")
        return {}
    finally:
        conn.close()


def load_raw_availabilities():
    """
    Load block-wise availability for each generator from genco__and_ipp
    and renewable profiles from forecast.
    Returns dict: {generator_name -> [96 float values], Solar -> [...], Wind -> [...], Hydro -> [...]}.
    """
    generators = load_raw_generators()
    availabilities = {g['name']: g['cap_profile'][:] for g in generators}

    fc = load_raw_forecast()
    if fc:
        availabilities['Solar'] = fc.get('solar', [0.0] * 96)
        availabilities['Wind'] = fc.get('wind', [0.0] * 96)
        availabilities['Hydro'] = fc.get('hydro', [0.0] * 96)
    else:
        availabilities['Solar'] = [0.0] * 96
        availabilities['Wind'] = [0.0] * 96
        availabilities['Hydro'] = [0.0] * 96

    state_totals = load_raw_state_thermal_totals()
    availabilities['State Thermal Total'] = state_totals.get('ap_thermal_net', [0.0] * 96)
    availabilities['State Thermal Total Raw'] = state_totals

    return availabilities


def load_raw_state_thermal_totals():
    """Load the AP THERMAL NET and AP THERMAL TOTAL profiles from genco_and_ipp."""
    conn = _conn()
    cur = conn.cursor()
    try:
        try:
            cur.execute("SELECT * FROM [genco__and_ipp]")
        except Exception:
            cur.execute("SELECT * FROM [genco_and_ipp]")
        rows = cur.fetchall()
        if not rows or len(rows) < 2:
            return {'ap_thermal_net': [0.0] * 96, 'ap_thermal_total': [0.0] * 96}

        header = [str(x).strip() if x is not None else '' for x in rows[0]]
        data_rows = rows[1:]
        idx_net = next((i for i, label in enumerate(header) if label and 'ap thermal net' in label.lower()), None)
        idx_total = next((i for i, label in enumerate(header) if label and 'ap thermal total' in label.lower()), None)

        def _fv(v):
            if v in (None, '', '#REF!'):
                return 0.0
            try:
                return float(v)
            except Exception:
                return 0.0

        ap_thermal_net = [0.0] * 96
        ap_thermal_total = [0.0] * 96
        block_index = 0
        for row in data_rows:
            if block_index >= 96:
                break
            if idx_net is not None and idx_net < len(row):
                ap_thermal_net[block_index] = _fv(row[idx_net])
            if idx_total is not None and idx_total < len(row):
                ap_thermal_total[block_index] = _fv(row[idx_total])
            block_index += 1

        return {'ap_thermal_net': ap_thermal_net, 'ap_thermal_total': ap_thermal_total}
    except Exception:
        return {'ap_thermal_net': [0.0] * 96, 'ap_thermal_total': [0.0] * 96}
    finally:
        conn.close()


def load_raw_prices():
    """Load 96-block RTM MCP from rtm_market."""
    conn = _conn()
    cur = conn.cursor()
    try:
        cur.execute("PRAGMA table_info([rtm_market])")
        cols = [c[1] for c in cur.fetchall()]

        mcp_kwh_col = next((c for c in cols if c.lower() == 'mcp_rs_kwh' or 'rs_kwh' in c.lower()), None)
        mcp_mwh_col = next((c for c in cols if 'mcp' in c.lower() and 'rs/mwh' in c.lower()), None)
        if mcp_kwh_col:
            price_col = mcp_kwh_col
            convert_from_kwh = True
        elif mcp_mwh_col:
            price_col = mcp_mwh_col
            convert_from_kwh = False
        else:
            return [3000.0] * 96

        cur.execute(f"SELECT [{price_col}] FROM [rtm_market]")
        rows = cur.fetchall()
        prices = []
        for r in rows:
            val = r[0]
            try:
                price = float(val)
                if convert_from_kwh:
                    price *= 1000.0
                prices.append(price)
            except Exception:
                continue
            if len(prices) >= 96:
                break

        if len(prices) < 96:
            prices += [3000.0] * (96 - len(prices))
        return prices[:96]
    except Exception as e:
        print("[database.py] Error loading prices:", e)
        return [3000.0] * 96
    finally:
        conn.close()


def load_yesterday_demand():
    """Load yesterday's SCADA actual demand from Scada_Daily_Report."""
    conn = _conn()
    cur = conn.cursor()
    try:
        cur.execute("PRAGMA table_info(Scada_Daily_Report)")
        cols = [c[1] for c in cur.fetchall()]
        # Column SYSCA_AT.SYSTEM.GRID_DMD_TOT.MW is the actual demand
        demand_col = next((c for c in cols if 'GRID_DMD_TOT' in c or 'DEMAND' in c.upper()), None)
        block_col = next((c for c in cols if 'BLOCK_NO' in c), None)
        if not demand_col:
            return [0.0] * 96
        if block_col:
            cur.execute(f"SELECT CAST([{block_col}] AS INTEGER), [{demand_col}] FROM Scada_Daily_Report ORDER BY CAST([{block_col}] AS INTEGER)")
        else:
            cur.execute(f"SELECT [{demand_col}] FROM Scada_Daily_Report")
        rows = cur.fetchall()
        demand = [0.0] * 96
        if block_col:
            for r in rows:
                try:
                    b = int(float(r[0]))
                    v = float(r[1])
                    if 1 <= b <= 96:
                        demand[b - 1] = v
                except Exception:
                    pass
        else:
            for i, r in enumerate(rows[:96]):
                try:
                    demand[i] = float(r[0])
                except Exception:
                    pass
        return demand
    except Exception as e:
        print("[database.py] Error loading yesterday demand:", e)
        return [0.0] * 96
    finally:
        conn.close()
