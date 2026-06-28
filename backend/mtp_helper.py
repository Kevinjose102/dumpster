import os
import sys
import json
import hashlib
import time
import shutil
from datetime import datetime
import re

date_patterns = [
    re.compile(r'(\d{4})(\d{2})(\d{2})[-_](\d{2})(\d{2})(\d{2})'),
    re.compile(r'(\d{4})(\d{2})(\d{2})')
]

def parse_date_from_name(name):
    for pattern in date_patterns:
        m = pattern.search(name)
        if m:
            try:
                parts = m.groups()
                if len(parts) == 6:
                    return datetime(int(parts[0]), int(parts[1]), int(parts[2]),
                                    int(parts[3]), int(parts[4]), int(parts[5]))
                elif len(parts) == 3:
                    return datetime(int(parts[0]), int(parts[1]), int(parts[2]))
            except ValueError:
                pass
    return None


# Configure standard console encoding to prevent encoding issues with print
sys.stdout.reconfigure(encoding='utf-8')

try:
    import comtypes.client
    HAS_COMTYPES = True
except ImportError:
    HAS_COMTYPES = False

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"}
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".3gp", ".mov", ".avi"}

# Scan these top-level folders on each storage volume; all subdirectories are scanned recursively.
ROOT_FOLDERS = ["DCIM", "Pictures"]

def parse_size_to_bytes(size_str):
    if not size_str:
        return 0
    try:
        parts = size_str.strip().split()
        if not parts:
            return 0
        num = float(parts[0].replace(",", ""))
        if len(parts) == 1:
            return int(num)
        unit = parts[1].upper()
        if "KB" in unit:
            return int(num * 1024)
        elif "MB" in unit:
            return int(num * 1024 * 1024)
        elif "GB" in unit:
            return int(num * 1024 * 1024 * 1024)
        return int(num)
    except Exception:
        return 0

def parse_date(date_str):
    if not date_str:
        return datetime.now()
    for fmt in ("%d-%m-%Y %H:%M", "%m/%d/%Y %I:%M %p", "%d-%b-%y %H:%M", "%d/%m/%Y %H:%M", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(date_str, fmt)
        except Exception:
            pass
    return datetime.now()

def detect_devices(shell=None):
    devices = []
    if not HAS_COMTYPES:
        return devices
        
    should_uninit = False
    try:
        if shell is None:
            comtypes.CoInitialize()
            shell = comtypes.client.CreateObject("Shell.Application")
            should_uninit = True
            
        drives = shell.NameSpace(17)
        if drives:
            for item in drives.Items():
                try:
                    path = item.Path
                    if not path or not path.startswith("::"):
                        continue
                    
                    name = item.Name
                    itype = ""
                    try:
                        itype = item.Type
                    except Exception:
                        pass
                        
                    if "usb" in path.lower() or itype == "Portable Device" or "portable" in itype.lower():
                        devices.append({
                            "id": path,
                            "name": name,
                            "type": "physical"
                        })
                except Exception as item_err:
                    sys.stderr.write(f"Warning: Skipping drive item due to error: {item_err}\n")
    except Exception as e:
        sys.stderr.write(f"Error in detect_devices: {e}\n")
    finally:
        if should_uninit:
            comtypes.CoUninitialize()
    return devices

def find_item_recursive(folder, parts):
    if not parts:
        return None
    part = parts[0]
    
    # 1. First try ParseName (direct lookup, extremely fast)
    item = folder.ParseName(part)
    if item:
        if len(parts) == 1:
            return item
        if item.IsFolder:
            return find_item_recursive(item.GetFolder, parts[1:])
            
    # 2. Fallback to looping (needed for storage root GUIDs or fallback matching)
    for item in folder.Items():
        system_name = os.path.basename(item.Path)
        if item.Name.lower() == part.lower() or system_name.lower() == part.lower():
            if len(parts) == 1:
                return item
            if item.IsFolder:
                return find_item_recursive(item.GetFolder, parts[1:])
                
    return None

def find_item_by_shell_path(shell, shell_path):
    drives = shell.NameSpace(17)
    if not drives:
        return None
        
    p2_parts = [p for p in shell_path.split("\\") if p]
    if not p2_parts:
        return None
        
    p2_parts_lower = [p.lower() for p in p2_parts]
        
    for item in drives.Items():
        p1_parts = [p for p in item.Path.split("\\") if p]
        p1_parts_lower = [p.lower() for p in p1_parts]
        
        # Check if shell_path matches the device path by collapsed parts
        if len(p2_parts_lower) >= len(p1_parts_lower) and p2_parts_lower[:len(p1_parts_lower)] == p1_parts_lower:
            rel_parts = p2_parts[len(p1_parts_lower):]
            if not rel_parts:
                return item
            return find_item_recursive(item.GetFolder, rel_parts)
            
        # Fallback to checking by friendly name
        if p2_parts[0].lower() == item.Name.lower():
            return find_item_recursive(item.GetFolder, p2_parts[1:])
            
    return None

def find_folder_by_relative_path(current_folder, path_segments):
    if not path_segments:
        return current_folder
    segment = path_segments[0]
    
    # 1. First try ParseName
    item = current_folder.ParseName(segment)
    if item and item.IsFolder:
        return find_folder_by_relative_path(item.GetFolder, path_segments[1:])
        
    # 2. Fallback to looping (needed if ParseName misses)
    for item in current_folder.Items():
        system_name = os.path.basename(item.Path)
        if (item.Name.lower() == segment.lower() or system_name.lower() == segment.lower()) and item.IsFolder:
            return find_folder_by_relative_path(item.GetFolder, path_segments[1:])
            
    return None

# Global flags to cache support of COM properties.
# Bypassing exceptions on MTP devices speeds up directory traversal significantly.
SUPPORT_ITEM_SIZE = True
SUPPORT_ITEM_MODIFY_DATE = True

def scan_folder_recursive(folder, category, files_list, subfolder_path="", parent_path="", visited=None):
    """Recursively scan a folder. Recurse into ALL subfolders.
    subfolder_path tracks the relative path from the root folder (e.g. 'Camera', 'Screenshots').
    """
    global SUPPORT_ITEM_SIZE, SUPPORT_ITEM_MODIFY_DATE

    if visited is None:
        visited = set()

    # Limit depth and total folder count to prevent hangs/overflows
    if len(visited) > 1000 or subfolder_path.count('/') > 8:
        return

    try:
        items = folder.Items()
    except Exception:
        return

    for item in items:
        try:
            name = item.Name
        except Exception:
            continue

        # Skip hidden files/folders and common system folders
        if name.startswith(".") or name.lower() in ("thumbnails", "cache", "metadata", "sent", "private"):
            continue

        ext = os.path.splitext(name.lower())[1]
        is_image = ext in IMAGE_EXTENSIONS
        is_video = ext in VIDEO_EXTENSIONS

        # Check if it is a media file first (faster extension match)
        is_media = is_image or is_video

        # Determine if it's a folder. If it has a media extension, we know it's not a folder!
        # This saves a COM call to item.IsFolder for all media files.
        is_folder = False
        if not is_media:
            try:
                is_folder = item.IsFolder
            except Exception:
                continue

        if is_folder:
            try:
                # Query path only for subfolders to prevent cycles, very low COM overhead since folders are rare
                folder_path = item.Path
            except Exception:
                folder_path = f"{parent_path}\\{name}" if parent_path else name

            norm_path = folder_path.lower()
            if norm_path in visited:
                continue
            visited.add(norm_path)

            sub_path = f"{subfolder_path}/{name}" if subfolder_path else name
            try:
                scan_folder_recursive(item.GetFolder, category, files_list, sub_path, folder_path, visited)
            except Exception as e:
                sys.stderr.write(f"Error scanning subfolder {name}: {e}\n")
            continue

        if not is_media:
            continue

        # Construct path locally - saves item.Path COM call!
        path_str = f"{parent_path}\\{name}" if parent_path else name

        size = 0
        try:
            size = item.ExtendedProperty("System.Size")
            if size is None:
                size = item.ExtendedProperty("Size")
        except Exception:
            pass

        if not size:
            try:
                val = item.Size
                if val and val > 0:
                    size = val
            except Exception:
                pass

        if not size:
            try:
                size_str = folder.GetDetailsOf(item, 2)
                size = parse_size_to_bytes(size_str)
            except Exception:
                size = 0

        mtime = parse_date_from_name(name)
        if not mtime:
            try:
                raw_mtime = item.ModifyDate
                if isinstance(raw_mtime, datetime):
                    mtime = raw_mtime
                elif raw_mtime:
                    mtime = parse_date(str(raw_mtime))
            except Exception:
                mtime = None

        if not mtime:
            try:
                mdate_raw = folder.GetDetailsOf(item, 3)
                mtime = parse_date(mdate_raw)
            except Exception:
                mtime = datetime.now()

        file_id = hashlib.md5(path_str.encode('utf-8')).hexdigest()
        files_list.append({
            "id": file_id,
            "name": name,
            "original_path": path_str,
            "size": size,
            "date": mtime.isoformat(),
            "category": category,
            "subfolder": subfolder_path,
            "file_type": "video" if is_video else "image",
            "extension": ext
        })

def scan_device(device_id, shell=None):
    files = []
    if not HAS_COMTYPES:
        return files
        
    should_uninit = False
    try:
        if shell is None:
            comtypes.CoInitialize()
            shell = comtypes.client.CreateObject("Shell.Application")
            should_uninit = True
            
        drives = shell.NameSpace(17)
        device_item = None
        
        # Normalize device_id by collapsing multiple backslashes
        device_id_parts = [p for p in device_id.split("\\") if p]
        
        for item in drives.Items():
            p1_parts = [p for p in item.Path.split("\\") if p]
            
            # Check exact, segment match, or friendly name match
            if (item.Path == device_id or 
                p1_parts == device_id_parts or 
                (device_id_parts and device_id_parts[0].lower() == item.Name.lower()) or
                item.Name.lower() == device_id.lower()):
                device_item = item
                break
                
        if not device_item:
            # Final fallback: if nothing matches, pick the first device item whose name is in device_id
            for item in drives.Items():
                if item.Name.lower() in device_id.lower() or device_id.lower() in item.Name.lower():
                    device_item = item
                    break
                    
        if not device_item:
            return files
            
        device_folder = device_item.GetFolder
        storage_folders = []
        for item in device_folder.Items():
            if item.IsFolder:
                storage_folders.append(item.GetFolder)
                
        if not storage_folders:
            return files
            
        visited = set()
        for storage_folder in storage_folders:
            for root_name in ROOT_FOLDERS:
                target_folder = find_folder_by_relative_path(storage_folder, [root_name])
                if target_folder:
                    try:
                        root_path = target_folder.Self.Path
                    except Exception:
                        root_path = ""
                    
                    if root_path:
                        visited.add(root_path.lower())
                    scan_folder_recursive(target_folder, root_name, files, parent_path=root_path, visited=visited)
    except Exception as e:
        sys.stderr.write(f"Error scanning device: {e}\n")
    finally:
        if should_uninit:
            comtypes.CoUninitialize()
    return files

def copy_file(src_path, dest_local_path, shell=None):
    if not HAS_COMTYPES:
        return False
    should_uninit = False
    try:
        if shell is None:
            comtypes.CoInitialize()
            shell = comtypes.client.CreateObject("Shell.Application")
            should_uninit = True
            
        dest_dir = os.path.dirname(dest_local_path)
        os.makedirs(dest_dir, exist_ok=True)
        dest_ns = shell.NameSpace(dest_dir)
        if not dest_ns:
            return False
            
        src_item = find_item_by_shell_path(shell, src_path)
        if not src_item:
            return False
            
        dest_ns.CopyHere(src_item, 1044)
        
        copied_path = os.path.join(dest_dir, src_item.Name)
        if os.path.exists(copied_path):
            if copied_path != dest_local_path:
                if os.path.exists(dest_local_path):
                    os.remove(dest_local_path)
                os.rename(copied_path, dest_local_path)
            return True
        return False
    except Exception as e:
        sys.stderr.write(f"Error copying file: {e}\n")
        return False
    finally:
        if should_uninit:
            comtypes.CoUninitialize()

def move_file(src_path, dest_local_path, shell=None):
    if not HAS_COMTYPES:
        return False
    should_uninit = False
    try:
        if shell is None:
            comtypes.CoInitialize()
            shell = comtypes.client.CreateObject("Shell.Application")
            should_uninit = True
            
        dest_dir = os.path.dirname(dest_local_path)
        os.makedirs(dest_dir, exist_ok=True)
        dest_ns = shell.NameSpace(dest_dir)
        if not dest_ns:
            return False
            
        src_item = find_item_by_shell_path(shell, src_path)
        if not src_item:
            return False
            
        dest_ns.MoveHere(src_item, 1044)
        
        copied_path = os.path.join(dest_dir, src_item.Name)
        if os.path.exists(copied_path):
            if copied_path != dest_local_path:
                if os.path.exists(dest_local_path):
                    os.remove(dest_local_path)
                os.rename(copied_path, dest_local_path)
            return True
        return False
    except Exception as e:
        sys.stderr.write(f"Error moving file: {e}\n")
        return False
    finally:
        if should_uninit:
            comtypes.CoUninitialize()

def delete_file(src_path, shell=None):
    if not HAS_COMTYPES:
        return False
    should_uninit = False
    try:
        if shell is None:
            comtypes.CoInitialize()
            shell = comtypes.client.CreateObject("Shell.Application")
            should_uninit = True
            
        src_item = find_item_by_shell_path(shell, src_path)
        if src_item:
            src_item.InvokeVerb("delete")
            return True
        return False
    except Exception as e:
        sys.stderr.write(f"Error deleting file: {e}\n")
        return False
    finally:
        if should_uninit:
            comtypes.CoUninitialize()

def restore_file(local_path, original_phone_path, shell=None):
    if not HAS_COMTYPES:
        return False
    should_uninit = False
    try:
        if shell is None:
            comtypes.CoInitialize()
            shell = comtypes.client.CreateObject("Shell.Application")
            should_uninit = True
            
        phone_dir = os.path.dirname(original_phone_path)
        dest_folder_item = find_item_by_shell_path(shell, phone_dir)
        if not dest_folder_item or not dest_folder_item.IsFolder:
            return False
        dest_ns = dest_folder_item.GetFolder
        
        local_dir = os.path.dirname(local_path)
        local_ns = shell.NameSpace(local_dir)
        if not local_ns:
            return False
        local_item = local_ns.ParseName(os.path.basename(local_path))
        if not local_item:
            return False
            
        dest_ns.CopyHere(local_item, 1044)
        return True
    except Exception as e:
        sys.stderr.write(f"Error restoring file: {e}\n")
        return False
    finally:
        if should_uninit:
            comtypes.CoUninitialize()

def run_server():
    if not HAS_COMTYPES:
        print(json.dumps({"error": "comtypes not available"}))
        return
        
    try:
        comtypes.CoInitialize()
        shell = comtypes.client.CreateObject("Shell.Application")
        print(json.dumps({"ready": True}), flush=True)
        
        while True:
            line = sys.stdin.readline()
            if not line:
                break
                
            try:
                req = json.loads(line.strip())
                action = req.get("action")
                
                if action == "devices":
                    res = detect_devices(shell=shell)
                    print(json.dumps({"success": True, "result": res}), flush=True)
                elif action == "scan":
                    device_id = req.get("device_id")
                    res = scan_device(device_id, shell=shell)
                    
                    cache_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".cache"))
                    os.makedirs(cache_dir, exist_ok=True)
                    scan_file = os.path.join(cache_dir, "scan_results.json")
                    try:
                        with open(scan_file, "w", encoding="utf-8") as f:
                            json.dump(res, f)
                        print(json.dumps({"success": True, "count": len(res)}), flush=True)
                    except Exception as cache_err:
                        print(json.dumps({"success": False, "error": f"Cache write error: {cache_err}"}), flush=True)
                elif action == "copy":
                    src = req.get("src")
                    dest = req.get("dest")
                    success = copy_file(src, dest, shell=shell)
                    print(json.dumps({"success": success}), flush=True)
                elif action == "move":
                    src = req.get("src")
                    dest = req.get("dest")
                    success = move_file(src, dest, shell=shell)
                    print(json.dumps({"success": success}), flush=True)
                elif action == "delete":
                    src = req.get("src")
                    success = delete_file(src, shell=shell)
                    print(json.dumps({"success": success}), flush=True)
                elif action == "restore":
                    src = req.get("src")
                    dest = req.get("dest")
                    success = restore_file(src, dest, shell=shell)
                    print(json.dumps({"success": success}), flush=True)
                else:
                    print(json.dumps({"success": False, "error": f"Unknown action: {action}"}), flush=True)
            except Exception as e:
                print(json.dumps({"success": False, "error": str(e)}), flush=True)
                
    except Exception as e:
        sys.stderr.write(f"Helper server exception: {e}\n")
    finally:
        comtypes.CoUninitialize()

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No action specified"}))
        return
        
    action = sys.argv[1]
    
    if action == "server":
        run_server()
    elif action == "devices":
        res = detect_devices()
        print(json.dumps(res))
    elif action == "scan":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "No device ID specified"}))
            return
        res = scan_device(sys.argv[2])
        cache_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".cache"))
        os.makedirs(cache_dir, exist_ok=True)
        scan_file = os.path.join(cache_dir, "scan_results.json")
        try:
            with open(scan_file, "w", encoding="utf-8") as f:
                json.dump(res, f)
            print(json.dumps({"success": True, "count": len(res)}))
        except Exception as e:
            sys.stderr.write(f"Error saving scan results to cache: {e}\n")
            print(json.dumps({"success": False, "error": str(e)}))
    elif action == "copy":
        if len(sys.argv) < 4:
            print(json.dumps({"error": "Source and destination paths required"}))
            return
        success = copy_file(sys.argv[2], sys.argv[3])
        print(json.dumps({"success": success}))
    elif action == "move":
        if len(sys.argv) < 4:
            print(json.dumps({"error": "Source and destination paths required"}))
            return
        success = move_file(sys.argv[2], sys.argv[3])
        print(json.dumps({"success": success}))
    elif action == "delete":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "Source path required"}))
            return
        success = delete_file(sys.argv[2])
        print(json.dumps({"success": success}))
    elif action == "restore":
        if len(sys.argv) < 4:
            print(json.dumps({"error": "Local and original paths required"}))
            return
        success = restore_file(sys.argv[2], sys.argv[3])
        print(json.dumps({"success": success}))
    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))

if __name__ == '__main__':
    main()
