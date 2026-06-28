"""Diagnostic script: detect devices, scan, and print results."""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))

import mtp_helper

print("=== Step 1: Detecting devices ===")
devices = mtp_helper.detect_devices()
print(f"Found {len(devices)} device(s):")
for d in devices:
    print(f"  id={d['id'][:80]}...  name={d['name']}  type={d['type']}")

if not devices:
    print("\nNo devices detected. Is the phone plugged in via USB and set to File Transfer (MTP) mode?")
    sys.exit(1)

device_id = devices[0]["id"]
print(f"\n=== Step 2: Scanning device_id={device_id[:80]}... ===")
start = time.time()
files = mtp_helper.scan_device(device_id)
elapsed = time.time() - start
print(f"Scan completed in {elapsed:.2f}s. Found {len(files)} files.")

if files:
    # Show first 5
    print("\nSample files:")
    for f in files[:5]:
        print(f"  {f['name']}  category={f['category']}  subfolder={f['subfolder']}  path_len={len(f['original_path'])}")
else:
    print("\n!!! No files found. Running deep diagnostic on folder structure... !!!")
    # Let's manually walk the device structure to see what's there
    try:
        import comtypes.client
        comtypes.CoInitialize()
        shell = comtypes.client.CreateObject("Shell.Application")
        drives = shell.NameSpace(17)
        
        for item in drives.Items():
            print(f"\nDrive: name={item.Name}  path={item.Path[:80]}  type={item.Type}")
            if item.Path.startswith("::") or "usb" in item.Path.lower() or item.Type == "Portable Device":
                print("  ^ This looks like an MTP device. Exploring storage...")
                device_folder = item.GetFolder
                for storage in device_folder.Items():
                    print(f"    Storage: {storage.Name}  IsFolder={storage.IsFolder}")
                    if storage.IsFolder:
                        sf = storage.GetFolder
                        for child in sf.Items():
                            print(f"      -> {child.Name}  IsFolder={child.IsFolder}")
                            if child.IsFolder and child.Name.upper() in ("DCIM", "PICTURES"):
                                cf = child.GetFolder
                                count = 0
                                for sub in cf.Items():
                                    count += 1
                                    if count <= 10:
                                        print(f"          -> {sub.Name}  IsFolder={sub.IsFolder}")
                                print(f"        (total items in {child.Name}: {count})")
        comtypes.CoUninitialize()
    except Exception as e:
        print(f"Diagnostic error: {e}")
