# PowerOpt

## What this project does

PowerOpt is a simple tool for power system operators. It helps manage electricity supply by:

- forecasting renewable output and demand,
- optimizing which generators should run,
- checking generator limits and ramp rates,
- suggesting when to buy power from market sources.

This makes it easier to keep the grid balanced and control operating cost.

## Main features

- Merit-order dispatch optimization for generators
- Renewable forecast support for solar, wind, and hydro
- Simple market purchase recommendation logic
- Runtime support for generator ramp rates and constraints
- Dashboard display with charts and KPIs
- Light and dark mode in the user interface

## Technology used

Frontend:
- React
- TypeScript
- Vite
- CSS

Backend:
- Python
- SQLAlchemy
- SQLite

## Folder structure

```
LGB_AGENTIC/
├── backend/
│   ├── database.py
│   ├── optimizer.py
│   ├── main.py
│   ├── requirements.txt
│   └── ...
├── public/
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── App.css
│   ├── index.css
│   ├── components/
│   └── utils/
├── package.json
├── README.md
└── tsconfig.json
```

## How to run this project

### Frontend steps

1. Open the project root folder.
2. Install Node dependencies:

```bash
npm install
```

3. Start the frontend:

```bash
npm run dev
```

4. Open the browser at:

```text
http://localhost:5174
```

### Backend steps

1. Open the `backend` folder.
2. Create a Python virtual environment:

```bash
cd backend
python -m venv my_env
```

3. Activate the environment:

```bash
.\my_env\Scripts\activate
```

4. Install backend packages:

```bash
pip install -r requirements.txt
```

5. Run the backend server or scripts as needed.

## How the system works

1. The system reads demand and renewable forecast data.
2. It calculates how much generation is available.
3. It sorts generators by cost and chooses the best units first.
4. It checks each generator’s limits and ramp rates.
5. When supply is not enough, it recommends market purchases.
6. It sends results to the dashboard for display.

## How the LPP optimizer works

The optimizer is in `backend/optimizer.py` and uses the PuLP library for linear programming. It performs two main steps:

- Baseline optimization for the full day (96 blocks) to get a reference schedule.
- Rolling block-by-block dispatch that applies gate-closure rules and locks central generator output after a boundary.

### What is used in the optimizer

- `PuLP` to build LP problems and solve them with `CBC`.
- `Generator` objects with type, cost, capacity, ramp rate, and availability.
- `Market` objects for RTM prices and market purchase limits.
- `MustRunForecast` for solar, wind, hydro, and IPP power.
- `SimulationParams` to pass all input data into the solver.

### Key rules in the model

- Must-run solar and wind are always included.
- Hydro has a dispatch limit and a daily budget.
- State thermal and IPP generators are dispatched with ramp limits.
- Central generator (CGS) output is locked after a gate-closure boundary depending on odd/even block rules.
- RTM purchase is allowed but treated as last resort with a high premium.
- Shortage and curtailment are penalized heavily to keep the model stable.

### Cost calculation

- Thermal generator cost = output × generator cost × 250.
- Hydro cost = hydro output × ₹2/kWh × 250.
- RTM cost = purchase × (MCP + premium) × 0.25.
- Shortage cost and curtailment cost are high penalties to avoid unserved energy and unnecessary spill.

### Output and recommendations

For each block, the optimizer returns:

- dispatch for each generator
- hydro dispatch and must-run totals
- RTM market buy decision
- shortage and curtailment values
- total cost and marginal cost
- alerts and recommendations for the next 2 hours

This section explains how your LP-based optimizer works and what it uses, so the README now documents the full LPP approach.

## Notes for users

- Keep the backend virtual environment activated when running Python scripts.
- Use the frontend server to view the dashboard and charts.
- If you change data or settings, restart the app to apply updates.

## Possible improvements

- Add weather forecast input
- Use real-time market price feeds
- Add more detailed demand forecasting
- Improve alert and notification handling

## Summary

PowerOpt is a practical demo tool for power dispatch planning. It combines a Python backend and a React frontend so operators can see optimization results and manage power purchase decisions more clearly.
