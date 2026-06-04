from database import load_raw_generators, load_raw_availabilities
import json

# Check what generators are loaded
gens = load_raw_generators()
print('=== GENERATORS LOADED ===')
for g in gens[:5]:
    print(f"{g['name']} - Cost: {g['cost']}, BD_COL: {g['bd_col']}")

# Check availabilities
avail = load_raw_availabilities()
print(f"\n=== AVAILABILITIES KEYS ({len(avail)} total) ===")
for key in list(avail.keys())[:10]:
    print(f"  {key}: {avail[key][:5]}...")

# Check if BD_QUANTUM columns match generator names
print(f"\n=== CHECKING COLUMN MAPPING ===")
for g in gens[:10]:
    bd_col = g['bd_col']
    if bd_col:
        if bd_col in avail:
            print(f"{g['name']} -> {bd_col}: {avail[bd_col][:5]}")
        else:
            print(f"{g['name']} -> {bd_col}: NOT FOUND in avail")
    else:
        print(f"{g['name']}: NO BD_COL mapping")

print("\n=== CHECKING ALL AVAILABILITY VALUES FOR FIRST GEN ===")
if gens and gens[0]['bd_col']:
    bd_col = gens[0]['bd_col']
    if bd_col in avail:
        print(f"{gens[0]['name']} ({bd_col}) all 96 blocks:")
        print(avail[bd_col])
