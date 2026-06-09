# PowerOpt

## Project overview

PowerOpt is a grid scheduling and dispatch planning application built for power system operators, planners, and energy analysts.

It reads 96-block day-ahead forecast data, computes a grid dispatch using real generator availability and cost constraints, and displays the results in an interactive chart-based dashboard. The system also runs a second cost-minimizing optimization to compare real dispatch against a lower-cost schedule and highlight savings.

This repository combines:
- a Python backend for data loading and optimization,
- a React + TypeScript frontend for the dashboard,
- a SQLite forecast database for real block-by-block inputs.

## What problem this solves

Power systems must balance supply and demand every 15 minutes. This tool helps by:

- forecasting renewable generation and load demand,
- choosing the right mix of generators from the cheapest available units,
- enforcing generator technical limits and ramp rate rules,
- deciding when to buy or sell power in the real-time market (RTM),
- estimating total operating cost and potential savings.

The goal is to help people understand how different schedules affect cost, shortage, surplus, and market interactions.

## What this application does

1. Loads 96-block forecast data from `src/LGB.db` via the backend.
2. Loads generator availability and cost data from the same forecast source.
3. Computes a block-by-block dispatch schedule using a rolling dispatch simulator.
4. Runs a second, daily cost optimization using the HiGHS LP solver.
5. Sends the results to the dashboard for interactive visualization.
6. Allows users to inspect block-level decisions such as RTM buy/sell, renewable curtailment, and shortage.

## Technology stack

### Frontend

- **React** for building UI components.
- **TypeScript** for typed frontend code.
- **Vite** for fast development and build.
- **Recharts** for charts and time-series visualizations.
- **Lucide React** for icons.
- **CSS** for layout, cards, and dashboard styling.

### Backend

- **Python** as the server and optimization runtime.
- **FastAPI** to expose HTTP endpoints for forecast, generator, and simulation data.
- **SQLAlchemy** for ORM access to the forecast database.
- **SQLite** for local forecast and generator data storage.
- **PuLP** for formulation and rolling-horizon dispatch logic.
- **HiGHS** via `highspy` for solving the full LP cost optimization.

### Data / database

- Forecast data is read from `src/LGB.db`.
- The backend also supports `forecast .db` or `forecast.db` if present.
- The database contains 96-block values for demand, solar, wind, hydro, CGS ceilings, and market prices.

## System architecture

The project is divided into two main layers:

1. **Backend layer** (`backend/`)
   - `main.py` exposes REST APIs.
   - `database.py` reads forecast and generator tables.
   - `optimizer.py` implements dispatch and cost optimization.

2. **Frontend layer** (`src/`)
   - `App.tsx` orchestrates fetch calls and user interaction.
   - `Dashboard.tsx` renders charts, tables, and block details.
   - `utils/optimizer.ts` contains helper functions for data formatting.

## How the optimization works

### Rolling dispatch simulation

The rolling dispatch simulator is designed to model realistic operational rules.

Key features:
- Runs over 96 blocks (15-minute intervals for one day).
- Sorts generators by merit order using rank and cost.
- Enforces generator availability and technical minimum limits.
- Applies ramp rate restrictions so output cannot change too fast.
- Uses market purchases only after local generation options are exhausted.
- Honors special CGS locking rules depending on whether the current block is odd or even.

The result is a feasible dispatch schedule that follows real operating behavior.

### HiGHS cost optimization

A second solver uses a linear programming model to minimize total operating cost across all 96 blocks.

The model includes:
- generator dispatch variables for every unit and every block,
- RTM market buy/sell variables,
- hydro dispatch variables,
- shortage and curtailment variables.

The objective minimizes:
- thermal generation cost,
- RTM buy cost with a premium (to make RTM a last resort),
- RTM sell revenue at a discounted price,
- shortage penalty,
- renewable curtailment penalty.

This optimization answers the question: "If we only focus on cost and respect technical constraints, what is the cheapest feasible schedule for the day?"

## What the graphs show

The dashboard uses Recharts to display the following key insights:

- **Demand vs Availability**: a block-by-block view showing how total available generation compares to forecast demand.
- **Thermal and renewable supply split**: state thermal, central thermal, IPP, solar, wind, hydro.
- **RTM activity**: quantities bought from and sold to the market in each block.
- **Shortage / Surplus**: where demand is not met or where excess energy exists.
- **Forecast delta**: the gap between total available energy and demand for each block.
- **RTM price curve**: market clearing price across the 96 blocks.

### Graph implementation details

The dashboard uses these chart types:
- `ComposedChart` for mixed line-and-bar timeline charts.
- `Area` and `Bar` series for stacked generation profiles.
- `Line` series for demand and price curves.
- `PieChart` for summary or category breakdowns.

Interactive tooltips show block-level values, and the table can scroll to the currently selected block.

## How to use it

### Run frontend

```bash
npm install
npm run dev
```

Visit:

```text
http://localhost:5174
```

### Run backend

```bash
cd backend
python -m venv my_env
.\my_env\Scripts\activate
pip install -r requirements.txt
python main.py
```

### API endpoints

- `GET /api/health` – backend health and database connection check.
- `GET /api/forecast` – 96-block demand and renewable forecast.
- `GET /api/market-prices` – RTM price curve.
- `GET /api/generators` – generator list with cost, availability, and technical minimum.
- `POST /api/simulation/run` – run the main dispatch and cost optimization simulation.

## Key domain concepts explained

- **Merit-order dispatch**: Generators are ranked by operating cost and used in cheapest-first order.
- **Technical minimum**: The minimum stable output for a thermal generator when it is committed.
- **Ramp rate**: The maximum change in generator output between consecutive 15-minute blocks.
- **RTM buy / sell**: Market transactions used to cover shortages or monetize surplus energy.
- **Curtailment**: Renewable energy that is available but cannot be used because demand is already met.
- **Shortage**: Demand that is not served by generation or market purchases.

## What this project demonstrates

- How a dispatch scheduler can combine forecast data, generator availability, and market prices.
- How an optimization model can compare an operational dispatch to an ideal cost-minimizing dispatch.
- How a dashboard can make complex 96-block schedules easy to understand.

## Folder structure

```
LGB_AGENTIC/
├── backend/
│   ├── database.py
│   ├── main.py
│   ├── optimizer.py
│   ├── requirements.txt
│   └── ...
├── public/
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── App.css
│   ├── index.css
│   ├── components/Dashboard.tsx
│   └── utils/optimizer.ts
├── package.json
├── README.md
└── tsconfig.json
```

## Future improvements

- Add weather forecast integration and dynamic solar/wind variability.
- Use live market price feeds instead of static RTM prices.
- Add generator commitment and unit start/stop cost modeling.
- Add an alert panel for shortage or curtailment warnings.
- Add exportable reports for daily dispatch results.
