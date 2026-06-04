# PowerOpt

## Overview

PowerOpt is an AI-based decision support system designed for real-time dispatch optimization, renewable forecasting, and market-aware power operations. It helps power system operators balance electricity demand with available generation sources such as thermal, solar, wind, and hydro power.

The system provides optimized generator dispatch, market purchase recommendations, and renewable energy forecasting to reduce operational costs and improve grid reliability.

---

## Features

* Merit Order Dispatch Optimization
* Renewable Energy Forecasting
* Real-Time Market (RTM) and IEX Integration
* Generator Ramp Rate Management
* Gate Closure Scheduling Support
* AI-Based Power Purchase Recommendations
* Interactive Dashboard with Charts and KPIs
* Dark and Light Mode Support

---

## Technology Stack

### Frontend

* React.js
* TypeScript
* Vite
* Chart.js / Recharts
* CSS

### Backend

* Python
* SQLAlchemy
* SQLite

---

## Project Structure

```text
Agentic/
│
├── backend/
│   ├── database.py
│   ├── optimizer.py
│   └── requirements.txt
│
├── src/
│   ├── components/
│   ├── utils/
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
│
├── package.json
└── README.md
```

---

## Installation

### Frontend Setup

Install dependencies:

```bash
npm install
```

Run the application:

```bash
npm run dev
```

Open:

```text
http://localhost:5174
```

---

### Backend Setup

Navigate to backend folder:

```bash
cd backend
```

Create virtual environment:

```bash
python -m venv my_env
```

Activate environment:

Windows:

```bash
.\my_env\Scripts\activate
```

Linux/Mac:

```bash
source my_env/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Create database tables:

```bash
python -c "from database import create_tables; create_tables()"
```

---

## Database Tables

* generators
* markets
* dispatch_blocks
* alerts
* market_prices
* excel_uploads

---

## Working

1. Load demand and renewable forecasts.
2. Calculate available generation.
3. Apply merit-order dispatch.
4. Check generator constraints and ramp rates.
5. Purchase power from markets if required.
6. Generate recommendations for operators.
7. Display results through dashboard visualizations.

---

## Future Enhancements

* Machine Learning-based demand forecasting
* Weather API integration
* Real-time SCADA connectivity
* Advanced market bidding strategies
* Mobile application support

---

## Conclusion

The TRANSCO Power Purchase Co-pilot helps power utilities make smarter power purchase decisions by combining optimization algorithms, renewable forecasting, and market intelligence in a single platform.
