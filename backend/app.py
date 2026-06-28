import os
import json
import time
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS

from mtp_manager import MTPManager
from recovery_bin import RecoveryBinManager
from logger import TransactionLogger

frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
app = Flask(__name__, static_folder=frontend_dist, static_url_path="")
CORS(app)

@app.route("/")
def serve_index():
    return send_from_directory(app.static_folder, "index.html")


SETTINGS_FILE = os.path.abspath("settings.json")

# Default settings
DEFAULT_SETTINGS = {
    "destinations": {
        "DCIM": r"D:\Phone Archive\DCIM",
        "Pictures": r"D:\Phone Archive\Pictures",
    },
    "retention_days": 7,
    "recovery_bin_dir": r"D:\Phone Archive\Recovery Bin"
}

def load_settings():
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r") as f:
                settings = json.load(f)
                # Merge default keys if missing
                for k, v in DEFAULT_SETTINGS.items():
                    if k not in settings:
                        settings[k] = v
                
                # Ensure inner keys of destinations are merged
                if "destinations" in settings:
                    for k, v in DEFAULT_SETTINGS["destinations"].items():
                        if k not in settings["destinations"]:
                            settings["destinations"][k] = v
                return settings
        except Exception:
            return DEFAULT_SETTINGS.copy()
    return DEFAULT_SETTINGS.copy()


def save_settings(settings):
    try:
        with open(SETTINGS_FILE, "w") as f:
            json.dump(settings, f, indent=4)
        return True
    except Exception as e:
        print(f"Error saving settings: {e}")
        return False

# Initialize settings and managers
settings = load_settings()

# Fallback directories setup
for cat, folder in settings["destinations"].items():
    if not os.path.exists("D:\\") and folder.startswith("D:\\"):
        # Relocate to C if D doesn't exist
        new_folder = folder.replace("D:\\Phone Archive\\", os.path.join(os.path.expanduser("~"), "PhoneArchive", ""))
        settings["destinations"][cat] = new_folder
        
if not os.path.exists("D:\\") and settings["recovery_bin_dir"].startswith("D:\\"):
    settings["recovery_bin_dir"] = os.path.join(os.path.expanduser("~"), "PhoneArchive", "RecoveryBin")

os.makedirs(settings["recovery_bin_dir"], exist_ok=True)
save_settings(settings)

# Managers
mtp_manager = MTPManager(use_mock_if_no_device=True)
recovery_bin = RecoveryBinManager(recovery_bin_dir=settings["recovery_bin_dir"])
tx_logger = TransactionLogger(log_dir=settings["recovery_bin_dir"])

# Active scan cache
current_device_id = None
current_device_name = ""
scanned_files = {} # file_id -> file_dict

# Session stats
session_stats = {
    "moved_files": 0,
    "deleted_files": 0,
    "freed_bytes": 0,
    "start_time": time.time()
}

@app.route('/api/status', methods=['GET'])
def get_status():
    global session_stats
    duration_minutes = int((time.time() - session_stats["start_time"]) / 60)
    return jsonify({
        "device_id": current_device_id,
        "device_name": current_device_name,
        "is_mock": mtp_manager.mock_active,
        "stats": {
            "moved": session_stats["moved_files"],
            "deleted": session_stats["deleted_files"],
            "freed_bytes": session_stats["freed_bytes"],
            "duration_minutes": duration_minutes
        }
    })

@app.route('/api/settings', methods=['GET', 'POST'])
def handle_settings():
    global settings, recovery_bin, tx_logger
    if request.method == 'POST':
        new_settings = request.json
        if not new_settings:
            return jsonify({"error": "Invalid request body"}), 400
            
        settings.update(new_settings)
        save_settings(settings)
        
        # Re-initialize managers if directories changed
        recovery_bin = RecoveryBinManager(recovery_bin_dir=settings["recovery_bin_dir"])
        tx_logger = TransactionLogger(log_dir=settings["recovery_bin_dir"])
        
        return jsonify({"success": True, "settings": settings})
        
    return jsonify(settings)

@app.route('/api/devices', methods=['GET'])
def list_devices():
    print("Flask [GET /api/devices]: Detecting MTP devices...")
    devices = mtp_manager.detect_devices()
    print(f"Flask [GET /api/devices]: Detected {len(devices)} devices: {[d['name'] for d in devices]}")
    return jsonify(devices)

@app.route('/api/scan', methods=['POST'])
def scan_device():
    global current_device_id, current_device_name, scanned_files
    data = request.json or {}
    device_id = data.get("device_id")
    device_name = data.get("device_name", "Device")
    
    print(f"Flask [POST /api/scan]: Received request for device_id={device_id}, device_name={device_name}")
    
    if not device_id:
        print("Flask [POST /api/scan]: Error - device_id is missing")
        return jsonify({"error": "device_id is required"}), 400
        
    start_time = time.time()
    files = mtp_manager.scan_device(device_id)
    print(f"Flask [POST /api/scan]: Scan completed in {time.time() - start_time:.2f} seconds. Found {len(files)} files.")
    
    current_device_id = device_id
    current_device_name = device_name
    
    # Cache scan results
    scanned_files = {f["id"]: f for f in files}
    
    # Auto clean expired files in recovery bin
    try:
        recovery_bin.clean_expired(settings["retention_days"])
    except Exception as e:
        print(f"Error cleaning expired recovery files: {e}")
        
    return jsonify(files)

@app.route('/api/thumbnail', methods=['GET'])
def get_thumbnail():
    file_id = request.args.get("id")
    path = request.args.get("path")
    ext = request.args.get("ext", ".jpg")
    
    if not file_id or not path:
        return jsonify({"error": "id and path are required"}), 400
        
    thumb_path = mtp_manager.generate_thumbnail(path, file_id, ext)
    return send_file(thumb_path, mimetype='image/jpeg')

@app.route('/api/file', methods=['GET'])
def get_file():
    import mimetypes
    file_id = request.args.get("id")
    path = request.args.get("path")
    
    if not file_id or not path:
        return jsonify({"error": "id and path are required"}), 400
        
    ext = os.path.splitext(path.lower())[1]
    cached_file = os.path.join(mtp_manager.CACHE_DIR, f"full_{file_id}{ext}")
    
    if not os.path.exists(cached_file):
        success = mtp_manager.copy_file_from_device(path, cached_file)
        if not success or not os.path.exists(cached_file):
            return jsonify({"error": "Failed to download original file from phone"}), 500
            
    mimetype, _ = mimetypes.guess_type(cached_file)
    return send_file(cached_file, mimetype=mimetype)

@app.route('/api/archive', methods=['POST'])
def archive_files():
    global session_stats, scanned_files
    data = request.json or {}
    file_ids = data.get("file_ids", [])
    
    if not file_ids:
        return jsonify({"error": "No file_ids specified"}), 400
        
    destinations = settings["destinations"]
    success_count = 0
    failed_files = []
    log_files = []
    
    for fid in file_ids:
        if fid not in scanned_files:
            failed_files.append({"id": fid, "error": "File not found in active scan."})
            continue
            
        file_info = scanned_files[fid]
        category = file_info["category"]
        original_path = file_info["original_path"]
        size = file_info["size"]
        name = file_info["name"]
        
        # Configure target folder
        dest_dir = destinations.get(category)
        if not dest_dir:
            dest_dir = os.path.join(os.path.expanduser("~"), "PhoneArchive", category)
            
        dest_path = os.path.join(dest_dir, name)
        
        # Verify and rename if local file exists to avoid overwrites
        base, ext = os.path.splitext(name)
        counter = 1
        while os.path.exists(dest_path):
            dest_path = os.path.join(dest_dir, f"{base}_{counter}{ext}")
            counter += 1
            
        # Perform Copy
        copy_success = mtp_manager.copy_file_from_device(original_path, dest_path)
        
        actual_size = size
        if size == 0 and copy_success and os.path.exists(dest_path):
            actual_size = os.path.getsize(dest_path)

        if copy_success and os.path.exists(dest_path) and os.path.getsize(dest_path) == actual_size:
            # Verification passed. Perform deletion.
            del_success = mtp_manager.delete_file_from_device(original_path)
            if del_success:
                success_count += 1
                session_stats["moved_files"] += 1
                session_stats["freed_bytes"] += actual_size
                
                log_files.append({
                    "name": name,
                    "original_path": original_path,
                    "destination_path": dest_path,
                    "size": actual_size,
                    "category": category
                })
                # Remove from cache
                scanned_files.pop(fid, None)
            else:
                # Failed deletion, delete the copied local file to remain atomic
                try: os.remove(dest_path)
                except Exception: pass
                failed_files.append({"id": fid, "name": name, "error": "Failed to delete original file from phone."})
        else:
            failed_files.append({"id": fid, "name": name, "error": "Failed to copy or verify file transfer."})
            
    # Log operation
    tx_id = None
    if log_files:
        tx_id = tx_logger.log_transaction("archive", log_files, {
            "device": current_device_name,
            "is_mock": mtp_manager.mock_active
        })
        
    return jsonify({
        "success_count": success_count,
        "failed_files": failed_files,
        "transaction_id": tx_id
    })

@app.route('/api/delete', methods=['POST'])
def delete_files():
    global session_stats, scanned_files
    data = request.json or {}
    file_ids = data.get("file_ids", [])
    
    if not file_ids:
        return jsonify({"error": "No file_ids specified"}), 400
        
    success_count = 0
    failed_files = []
    log_files = []
    
    for fid in file_ids:
        if fid not in scanned_files:
            failed_files.append({"id": fid, "error": "File not found in active scan."})
            continue
            
        file_info = scanned_files[fid]
        category = file_info["category"]
        original_path = file_info["original_path"]
        size = file_info["size"]
        name = file_info["name"]
        
        # Source copy function for Recovery Bin move (moves file safely)
        # We wrap mtp_manager.move_file_from_device as the source copy function
        # This will copy the file to local Recovery Bin and delete it from phone in one go.
        move_func = lambda dest_path: mtp_manager.move_file_from_device(original_path, dest_path)
        
        try:
            record = recovery_bin.add_file(
                file_name=name,
                original_path=original_path,
                original_device=current_device_name,
                size=size,
                category=category,
                source_copy_func=move_func
            )
            
            success_count += 1
            session_stats["deleted_files"] += 1
            session_stats["freed_bytes"] += record["size"]
            
            log_files.append({
                "name": name,
                "original_path": original_path,
                "recovery_id": record["id"],
                "size": record["size"],
                "category": category
            })
            # Remove from cache
            scanned_files.pop(fid, None)
            
        except Exception as e:
            failed_files.append({"id": fid, "name": name, "error": str(e)})
            
    # Log operation
    tx_id = None
    if log_files:
        tx_id = tx_logger.log_transaction("delete", log_files, {
            "device": current_device_name,
            "is_mock": mtp_manager.mock_active
        })
        
    return jsonify({
        "success_count": success_count,
        "failed_files": failed_files,
        "transaction_id": tx_id
    })

@app.route('/api/recovery-bin', methods=['GET'])
def list_recovery_bin():
    return jsonify(recovery_bin.list_files())

@app.route('/api/recovery-bin/restore', methods=['POST'])
def restore_recovery_files():
    data = request.json or {}
    recovery_ids = data.get("recovery_ids", [])
    
    if not recovery_ids:
        return jsonify({"error": "No recovery_ids specified"}), 400
        
    success_count = 0
    failed_files = []
    
    restore_func = lambda local_path, phone_path: mtp_manager.copy_file_to_device(local_path, phone_path)
    
    for rid in recovery_ids:
        try:
            record = recovery_bin.restore_file(rid, restore_func)
            success_count += 1
        except Exception as e:
            failed_files.append({"id": rid, "error": str(e)})
            
    return jsonify({
        "success_count": success_count,
        "failed_files": failed_files
    })

@app.route('/api/recovery-bin/purge', methods=['POST'])
def purge_recovery_files():
    data = request.json or {}
    recovery_ids = data.get("recovery_ids", [])
    
    if not recovery_ids:
        # If empty body or select all not specified, check for purge_all flag
        if data.get("all", False):
            recovery_bin.purge_all()
            return jsonify({"success": True})
        return jsonify({"error": "No recovery_ids specified"}), 400
        
    success_count = 0
    for rid in recovery_ids:
        if recovery_bin.purge_file(rid):
            success_count += 1
            
    return jsonify({
        "success_count": success_count
    })

@app.route('/api/history', methods=['GET'])
def get_transaction_history():
    return jsonify(tx_logger.get_history())

@app.route('/api/undo', methods=['POST'])
def undo_last_operation():
    global session_stats
    last_tx = tx_logger.get_last_transaction()
    if not last_tx:
        return jsonify({"error": "No operations to undo."}), 400
        
    action = last_tx["action"]
    files = last_tx["files"]
    success_count = 0
    failed_files = []
    
    if action == "archive":
        # Undo archiving: Copy files from local back to the phone, then delete local PC file
        for f in files:
            local_path = f["destination_path"]
            phone_path = f["original_path"]
            
            if not os.path.exists(local_path):
                failed_files.append({"name": f["name"], "error": "Archived file no longer exists on PC."})
                continue
                
            # Copy back to phone
            copy_back = mtp_manager.copy_file_to_device(local_path, phone_path)
            if copy_back:
                # Delete PC archived file
                try:
                    os.remove(local_path)
                    success_count += 1
                    session_stats["moved_files"] = max(0, session_stats["moved_files"] - 1)
                    session_stats["freed_bytes"] = max(0, session_stats["freed_bytes"] - f["size"])
                except Exception as e:
                    failed_files.append({"name": f["name"], "error": f"Failed to delete PC archive file: {e}"})
            else:
                failed_files.append({"name": f["name"], "error": "Failed to copy file back to phone."})
                
    elif action == "delete":
        # Undo deletion: Restore files from Recovery Bin back to the phone
        restore_func = lambda local_path, phone_path: mtp_manager.copy_file_to_device(local_path, phone_path)
        for f in files:
            rid = f.get("recovery_id")
            if not rid:
                failed_files.append({"name": f["name"], "error": "No recovery ID available to restore."})
                continue
                
            try:
                recovery_bin.restore_file(rid, restore_func)
                success_count += 1
                session_stats["deleted_files"] = max(0, session_stats["deleted_files"] - 1)
                session_stats["freed_bytes"] = max(0, session_stats["freed_bytes"] - f["size"])
            except Exception as e:
                failed_files.append({"name": f["name"], "error": str(e)})
                
    # Remove from log history if fully or partially restored
    if success_count > 0:
        tx_logger.remove_last_transaction()
        
    return jsonify({
        "action_undone": action,
        "success_count": success_count,
        "failed_files": failed_files
    })

if __name__ == '__main__':
    app.run(port=5000, debug=True)
