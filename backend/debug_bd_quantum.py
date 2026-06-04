import sqlite3

db_path = r"C:\Users\sc\Downloads\LGB_AGENTIC\forecast .db"
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Get table structure
cur.execute("PRAGMA table_info(BD_QUANTUM)")
cols = [c[1] for c in cur.fetchall()]
print(f"=== BD_QUANTUM COLUMNS ({len(cols)} total) ===")
print(cols[:10])

# Get first 10 rows from BD_QUANTUM
print("\n=== FIRST 10 ROWS FROM BD_QUANTUM ===")
cur.execute("SELECT * FROM BD_QUANTUM LIMIT 10")
rows = cur.fetchall()
for i, row in enumerate(rows):
    print(f"Row {i}: Block={row[0]}, Col1={row[1]}, Col2={row[2]}, Col3={row[3]}, Col4={row[4]}")

# Check if all rows are the same for a column
print("\n=== CHECKING IF VALUES VARY BY BLOCK ===")
cur.execute(f"SELECT Block, '{cols[1]}' FROM BD_QUANTUM")
# Actually, let me do this properly:
col_name = cols[1]  # e.g., 'Kudgi'
cur.execute(f"SELECT Block, [{col_name}] FROM BD_QUANTUM ORDER BY CAST(Block AS INTEGER) LIMIT 20")
print(f"Values for column '{col_name}':")
for row in cur.fetchall():
    print(f"  Block {row[0]}: {row[1]}")

conn.close()
