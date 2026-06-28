"""Quick API test against the running Flask server."""
import urllib.request, json

BASE = "http://127.0.0.1:5000/api"

# 1. Check devices
r = urllib.request.urlopen(f"{BASE}/devices")
devices = json.loads(r.read())
print(f"Devices: {len(devices)}")
for d in devices:
    print(f"  name={d['name']}  type={d['type']}  id_len={len(d['id'])}")

if not devices:
    print("No devices returned from the server!")
    exit(1)

# 2. Scan
dev = devices[0]
req = urllib.request.Request(
    f"{BASE}/scan",
    data=json.dumps({"device_id": dev["id"], "device_name": dev["name"]}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST"
)
r = urllib.request.urlopen(req, timeout=120)
files = json.loads(r.read())
print(f"\nScan returned {len(files)} files")
if files:
    cats = {}
    for f in files:
        cats[f["category"]] = cats.get(f["category"], 0) + 1
    print("By category:", cats)
    print("First 3 files:")
    for f in files[:3]:
        print(f"  {f['name']}  cat={f['category']}  sub={f['subfolder']}")
else:
    print("!!! API returned 0 files !!!")
