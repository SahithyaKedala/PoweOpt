import sqlite3

db_path = r"C:\Users\sc\Downloads\LGB_AGENTIC\forecast .db"
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Get Forecast table structure
print("=== FORECAST TABLE COLUMNS ===")
cur.execute("PRAGMA table_info(Forecast)")
cols = [(c[1], c[2]) for c in cur.fetchall()]
for col_name, col_type in cols:
    print(f"  {col_name}: {col_type}")

# Get first 10 rows from Forecast
print("\n=== FIRST 15 ROWS FROM FORECAST ===")
cur.execute("SELECT * FROM Forecast LIMIT 15")
rows = cur.fetchall()
col_names = [c[1] for c in cols]

for i, row in enumerate(rows):
    print(f"\nBlock {row[0]}:")
    for j, val in enumerate(row):
        if j < len(col_names):
            print(f"  {col_names[j]}: {val}")

conn.close()
