#!/usr/bin/env python3
import urllib.request
import json

data = json.dumps({'currentBlock': 1}).encode()
req = urllib.request.Request(
    'http://127.0.0.1:8000/api/simulation/run',
    data=data,
    headers={'Content-Type': 'application/json'}
)

try:
    print("Testing LPP solver endpoint /api/simulation/run ...")
    result = json.loads(urllib.request.urlopen(req, timeout=180).read())
    
    print("\n✅ Simulation response received successfully!")
    print(f"   - Total Dispatches: {len(result.get('dispatches', []))} blocks")
    print(f"   - Total Cost: ₹{result.get('totalCost', 'N/A')}")
    print(f"   - Alerts: {len(result.get('alerts', []))}")
    
    if result.get('dispatches'):
        d = result['dispatches'][0]
        print(f"\n   Block 1 Details:")
        print(f"   - Time: {d.get('timeStr')}")
        print(f"   - Demand: {d.get('demand')} MW")
        print(f"   - Solar: {d.get('solar')} MW")
        print(f"   - Wind: {d.get('wind')} MW")
        print(f"   - Hydro: {d.get('hydro')} MW (LSL: {d.get('hydro_lsl')}, USL: {d.get('hydro_usl')})")
        print(f"   - Thermal Dispatch: {d.get('thermalDispatch')} MW")
        print(f"   - Merit Order Generators: {len(d.get('meritOrderOutputs', []))}")
        print(f"   - RTM Purchase: {d.get('marketBuys', {}).get('rtm', 0)} MW")
        print(f"   - Block Cost: ₹{d.get('totalCost')}")
        
        if d.get('meritOrderOutputs'):
            print(f"\n   Top 3 Dispatched Generators (Merit Order):")
            for i, gen in enumerate(d.get('meritOrderOutputs', [])[:3]):
                print(f"     {i+1}. {gen['name']}: {gen['output']} MW @ ₹{gen['cost']}/kWh (Rank {gen['rank']})")
    
    print("\n✅ Application is running and solver is working!")
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
