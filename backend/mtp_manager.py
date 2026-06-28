import os
import sys
import time
import shutil
import hashlib
import random
import subprocess
import json
import threading

from datetime import datetime, timedelta
from PIL import Image, ImageDraw, ImageFont

mtp_lock = threading.Lock()

# Initialize comtypes COM access if on Windows
try:
    import comtypes.client
    HAS_COMTYPES = True
except ImportError:
    HAS_COMTYPES = False

MOCK_PHONE_DIR = os.path.abspath(".mock_phone")
CACHE_DIR = os.path.abspath(".cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# Scan these top-level folders; all subdirectories inside are scanned recursively.
ROOT_FOLDERS = ["DCIM", "Pictures"]

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"}
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".3gp", ".mov", ".avi"}

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

class MTPManager:
    CACHE_DIR = CACHE_DIR

    def __init__(self, use_mock_if_no_device=True):
        self.use_mock_if_no_device = use_mock_if_no_device
        self.mock_active = False
        self.helper_process = None
        self.helper_lock = threading.Lock()
        
        # Verify and setup mock folder if needed
        self._setup_mock_device()

    def _start_helper(self):
        self._stop_helper()
        helper_path = os.path.join(os.path.dirname(__file__), "mtp_helper.py")
        cmd = [sys.executable, helper_path, "server"]
        print(f"MTPManager: Starting persistent helper process: {' '.join(cmd)}")
        try:
            self.helper_process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                bufsize=1
            )
            # Read the ready signal
            ready_line = self.helper_process.stdout.readline()
            if ready_line:
                try:
                    ready_msg = json.loads(ready_line.strip())
                    if ready_msg.get("ready"):
                        print("MTPManager: Persistent helper ready.")
                        return
                except Exception:
                    pass
            print("MTPManager: Persistent helper failed to signal ready.")
            self._stop_helper()
        except Exception as e:
            print(f"MTPManager: Exception starting persistent helper: {e}")
            self.helper_process = None

    def _stop_helper(self):
        if self.helper_process:
            print("MTPManager: Stopping persistent helper subprocess...")
            try:
                self.helper_process.stdin.close()
            except Exception:
                pass
            try:
                self.helper_process.terminate()
                self.helper_process.wait(timeout=1)
            except Exception:
                try:
                    self.helper_process.kill()
                except Exception:
                    pass
            self.helper_process = None

    def _send_to_helper(self, cmd_dict):
        with self.helper_lock:
            if not self.helper_process or self.helper_process.poll() is not None:
                self._start_helper()
                
            if not self.helper_process:
                print("MTPManager: Helper subprocess not available.")
                return None
                
            try:
                cmd_json = json.dumps(cmd_dict)
                print(f"MTPManager: Sending helper command: {cmd_dict.get('action')}...")
                start_time = time.time()
                self.helper_process.stdin.write(cmd_json + "\n")
                self.helper_process.stdin.flush()
                
                res_line = self.helper_process.stdout.readline()
                elapsed = time.time() - start_time
                if not res_line:
                    print("MTPManager: Helper subprocess closed stdout unexpectedly.")
                    self._stop_helper()
                    return None
                    
                res = json.loads(res_line.strip())
                print(f"MTPManager: Helper response received in {elapsed:.2f}s.")
                return res
            except Exception as e:
                print(f"MTPManager: Error communicating with helper: {e}")
                self._stop_helper()
                return None

    def __del__(self):
        try:
            self._stop_helper()
        except Exception:
            pass

    def _setup_mock_device(self):
        """
        Creates a mock phone storage inside workspace with high-fidelity colored blocks
        representing photo/video files for testing purposes.
        """
        if os.path.exists(MOCK_PHONE_DIR):
            return
            
        print("Setting up Simulated Phone Media...")
        os.makedirs(MOCK_PHONE_DIR, exist_ok=True)
        
        # Build folder structure mirroring a real Android phone
        mock_folders = [
            os.path.join(MOCK_PHONE_DIR, "DCIM", "Camera"),
            os.path.join(MOCK_PHONE_DIR, "DCIM", "Screenshots"),
            os.path.join(MOCK_PHONE_DIR, "Pictures", "Screenshots"),
            os.path.join(MOCK_PHONE_DIR, "Pictures", "Instagram"),
        ]
        for folder in mock_folders:
            os.makedirs(folder, exist_ok=True)

        random.seed(42)
        
        def create_mock_image(file_path, text, color, date_modified):
            try:
                img = Image.new('RGB', (800, 600), color=color)
                draw = ImageDraw.Draw(img)
                draw.rectangle([40, 40, 760, 560], outline=(255, 255, 255), width=2)
                draw.text((80, 80), text, fill=(255, 255, 255))
                draw.text((80, 200), f"Date: {date_modified.strftime('%Y-%m-%d %H:%M')}", fill=(200, 200, 200))
                img.save(file_path, "JPEG")
                mod_time = time.mktime(date_modified.timetuple())
                os.utime(file_path, (mod_time, mod_time))
            except Exception as e:
                print(f"Error creating mock image: {e}")

        now = datetime.now()
        dates = [
            now - timedelta(hours=random.randint(1, 12)),
            now - timedelta(days=random.randint(1, 6)),
            now - timedelta(days=random.randint(8, 28)),
            now - timedelta(days=random.randint(32, 60)),
            now - timedelta(days=random.randint(365, 400)),
        ]

        # DCIM/Camera — photos and videos
        for i in range(30):
            date = random.choice(dates)
            fpath = os.path.join(MOCK_PHONE_DIR, "DCIM", "Camera", f"IMG_{date.strftime('%Y%m%d_%H%M%S')}_{i}.jpg")
            create_mock_image(fpath, f"CAMERA #{i}", (23, 165, 137), date)
        for i in range(8):
            date = random.choice(dates)
            fpath = os.path.join(MOCK_PHONE_DIR, "DCIM", "Camera", f"VID_{date.strftime('%Y%m%d_%H%M%S')}_{i}.mp4")
            create_mock_image(fpath, f"VIDEO #{i}", (20, 20, 20), date)

        # DCIM/Screenshots
        for i in range(20):
            date = random.choice(dates)
            fpath = os.path.join(MOCK_PHONE_DIR, "DCIM", "Screenshots", f"Screenshot_{date.strftime('%Y%m%d_%H%M%S')}_{i}.jpg")
            create_mock_image(fpath, f"SCREENSHOT #{i}", (33, 47, 61), date)

        # Pictures/Screenshots
        for i in range(15):
            date = random.choice(dates)
            fpath = os.path.join(MOCK_PHONE_DIR, "Pictures", "Screenshots", f"Screenshot_{date.strftime('%Y%m%d_%H%M%S')}_{i}.jpg")
            create_mock_image(fpath, f"PICS/SCREENSHOT #{i}", (50, 60, 80), date)

        # Pictures/Instagram
        for i in range(12):
            date = random.choice(dates)
            fpath = os.path.join(MOCK_PHONE_DIR, "Pictures", "Instagram", f"Insta_{date.strftime('%Y%m%d_%H%M%S')}_{i}.jpg")
            create_mock_image(fpath, f"INSTAGRAM #{i}", (130, 50, 100), date)

        print("Simulated Phone Media set up successfully.")

    def detect_devices(self):
        """
        Returns a list of connected MTP devices. If none are found and use_mock_if_no_device is true,
        returns the mock simulator.
        """
        devices = []
        res = self._send_to_helper({"action": "devices"})
        if res and res.get("success"):
            devices = res.get("result", [])
            
        if not devices and self.use_mock_if_no_device:
            devices.append({
                "id": "mock_device_simulator",
                "name": "Simulated Android Phone (Demo)",
                "type": "mock"
            })
            
        return devices

    def scan_device(self, device_id):
        """
        Scans all categories for the selected device.
        """
        if device_id == "mock_device_simulator":
            self.mock_active = True
            return self._scan_mock_device()
        else:
            self.mock_active = False
            return self._scan_physical_device(device_id)

    def _scan_mock_device(self):
        """
        Scans the local simulated phone folder under DCIM and Pictures recursively.
        The category is the top-level root folder name (DCIM or Pictures).
        """
        files = []

        for root_folder in ROOT_FOLDERS:
            root_path = os.path.join(MOCK_PHONE_DIR, root_folder)
            if not os.path.exists(root_path):
                continue
            for dirpath, _, filenames in os.walk(root_path):
                for filename in filenames:
                    file_path = os.path.join(dirpath, filename)
                    ext = os.path.splitext(filename.lower())[1]
                    is_image = ext in IMAGE_EXTENSIONS
                    is_video = ext in VIDEO_EXTENSIONS
                    if not (is_image or is_video):
                        continue
                    stat = os.stat(file_path)
                    mtime = datetime.fromtimestamp(stat.st_mtime)
                    file_id = hashlib.md5(file_path.encode('utf-8')).hexdigest()
                    # subfolder relative to root (e.g. "Camera", "Screenshots")
                    subfolder = os.path.relpath(dirpath, root_path)
                    if subfolder == ".":
                        subfolder = ""
                    files.append({
                        "id": file_id,
                        "name": filename,
                        "original_path": file_path,
                        "size": stat.st_size,
                        "date": mtime.isoformat(),
                        "category": root_folder,
                        "subfolder": subfolder,
                        "file_type": "video" if is_video else "image",
                        "extension": ext
                    })
        return files

    def _scan_physical_device(self, device_id):
        """
        Scans a physical MTP device using Windows Shell COM object.
        """
        print(f"MTPManager._scan_physical_device: Starting scan for device_id={device_id[:60]}...")
        res = self._send_to_helper({"action": "scan", "device_id": device_id})
        print(f"MTPManager._scan_physical_device: Helper returned: {res}")
        if res and res.get("success"):
            scan_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".cache", "scan_results.json"))
            print(f"MTPManager._scan_physical_device: Reading cache from {scan_file}")
            try:
                with open(scan_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                print(f"MTPManager._scan_physical_device: Loaded {len(data)} files from cache")
                return data
            except Exception as e:
                print(f"Error reading scan results from cache: {e}")
        else:
            print(f"MTPManager._scan_physical_device: Helper did NOT return success. res={res}")
        return []

    def _find_folder_by_relative_path(self, current_folder, path_segments):
        if not path_segments:
            return current_folder
            
        segment = path_segments[0]
        for item in current_folder.Items():
            if item.Name.lower() == segment.lower() and item.IsFolder:
                return self._find_folder_by_relative_path(item.GetFolder, path_segments[1:])
        return None

    def _scan_folder_recursive(self, folder, category, files_list, depth=0):
        # We limit recursion to only 1 level deep and only for WhatsApp categories
        is_whatsapp = "whatsapp" in category.lower()
        
        for item in folder.Items():
            is_folder = item.IsFolder
            name = item.Name
            
            if is_folder:
                if is_whatsapp and depth == 0 and name.lower() in ("sent", "private"):
                    try:
                        self._scan_folder_recursive(item.GetFolder, category, files_list, depth + 1)
                    except Exception as e:
                        print(f"Error scanning WhatsApp subfolder {name}: {e}")
                continue
                
            name_lower = name.lower()
            ext = os.path.splitext(name_lower)[1]
            is_image = ext in IMAGE_EXTENSIONS
            is_video = ext in VIDEO_EXTENSIONS
            
            if not (is_image or is_video):
                continue
                
            # Classify correctly: videos inside DCIM/Camera go to Videos, not Camera Photos
            final_cat = category
            if category == "Camera Photos" and is_video:
                final_cat = "Videos"
                
            # Retrieve file properties from Shell details (fast and reliable)
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
                
            try:
                mdate_raw = folder.GetDetailsOf(item, 3) # Modified column
                mtime = parse_date(mdate_raw)
            except Exception:
                mtime = datetime.now()
            
            file_id = hashlib.md5(item.Path.encode('utf-8')).hexdigest()
            files_list.append({
                "id": file_id,
                "name": name,
                "original_path": item.Path, # Full Shell path
                "size": size,
                "date": mtime.isoformat(),
                "category": final_cat,
                "file_type": "video" if is_video else "image",
                "extension": ext
            })


    def copy_file_from_device(self, src_path, dest_local_path):
        """
        Copies a file from the device to a local PC path.
        Handles both mock files (local) and physical MTP files (via shell namespace).
        """
        if self.mock_active or src_path.startswith(MOCK_PHONE_DIR) or os.path.exists(src_path):
            try:
                # Create destination directory if not exists
                os.makedirs(os.path.dirname(dest_local_path), exist_ok=True)
                shutil.copy2(src_path, dest_local_path)
                return True
            except Exception as e:
                print(f"Error copying mock file: {e}")
                return False
        else:
            res = self._send_to_helper({"action": "copy", "src": src_path, "dest": dest_local_path})
            return res.get("success", False) if res else False

    def delete_file_from_device(self, src_path):
        """
        Deletes a file from the device.
        """
        if self.mock_active or src_path.startswith(MOCK_PHONE_DIR) or os.path.exists(src_path):
            try:
                if os.path.exists(src_path):
                    os.remove(src_path)
                return True
            except Exception as e:
                print(f"Error deleting mock file: {e}")
                return False
        else:
            res = self._send_to_helper({"action": "delete", "src": src_path})
            return res.get("success", False) if res else False

    def move_file_from_device(self, src_path, dest_local_path):
        """
        Moves a file from the device to a local PC path (which automatically deletes it from the phone).
        Uses MoveHere silently.
        """
        if self.mock_active or src_path.startswith(MOCK_PHONE_DIR) or os.path.exists(src_path):
            try:
                os.makedirs(os.path.dirname(dest_local_path), exist_ok=True)
                shutil.move(src_path, dest_local_path)
                return True
            except Exception as e:
                print(f"Error moving mock file: {e}")
                return False
        else:
            res = self._send_to_helper({"action": "move", "src": src_path, "dest": dest_local_path})
            return res.get("success", False) if res else False

    def copy_file_to_device(self, local_path, original_phone_path):
        """
        Copies a file from PC back to the phone (used during Restore/Undo).
        """
        if self.mock_active or original_phone_path.startswith(MOCK_PHONE_DIR):
            try:
                os.makedirs(os.path.dirname(original_phone_path), exist_ok=True)
                shutil.copy2(local_path, original_phone_path)
                return True
            except Exception as e:
                print(f"Error copying mock file to phone: {e}")
                return False
        else:
            res = self._send_to_helper({"action": "restore", "src": local_path, "dest": original_phone_path})
            return res.get("success", False) if res else False

    def _find_item_by_shell_path(self, shell, shell_path):
        r"""
        Helper that traverses the Shell namespace from 'This PC' to find a specific item.
        The path is typically formatted like "::..." or "Pixel 6/Internal storage/DCIM/Camera/photo.jpg"
        """
        drives = shell.NameSpace(17)
        if not drives:
            return None
            
        # If it's a GUID path like ::{20D04FE0-3AEA-1069-A2D8-08002B30309D}\...
        # We parse the path components
        # Let's list drives and match
        # If shell_path matches a direct item path in Namespace 17
        for item in drives.Items():
            if shell_path.startswith(item.Path):
                # We found the device! Let's traverse remaining path
                rel_path = shell_path[len(item.Path):].strip("\\")
                if not rel_path:
                    return item
                parts = rel_path.split("\\")
                return self._find_item_recursive(item.GetFolder, parts)
                
            # Sometimes the path is friendly-formatted: "Pixel 6\Internal shared storage\DCIM\..."
            # Let's match item.Name
            parts = shell_path.split("\\")
            if parts[0].lower() == item.Name.lower():
                return self._find_item_recursive(item.GetFolder, parts[1:])
                
        return None

    def _find_item_recursive(self, folder, parts):
        if not parts:
            return None
            
        part = parts[0]
        for item in folder.Items():
            if item.Name.lower() == part.lower():
                if len(parts) == 1:
                    return item
                if item.IsFolder:
                    return self._find_item_recursive(item.GetFolder, parts[1:])
        return None

    def generate_thumbnail(self, file_path, file_id, extension):
        """
        Generates and caches a thumbnail for the image/video.
        Returns the cached thumbnail path.
        """
        cached_path = os.path.join(CACHE_DIR, f"{file_id}.jpg")
        if os.path.exists(cached_path):
            return cached_path
            
        if extension.lower() in VIDEO_EXTENSIONS:
            return self._create_fallback_thumbnail(file_id, extension)
            
        # Generate thumbnail
        # If mock mode, we can just resize the local file
        # If physical mode, we download the original file to a temp file, resize it, and delete the temp file.
        temp_file = os.path.join(CACHE_DIR, f"temp_{file_id}{extension}")
        
        try:
            # Copy to temp file on PC
            success = self.copy_file_from_device(file_path, temp_file)
            if not success or not os.path.exists(temp_file):
                # Fallback: serve a default placeholder
                return self._create_fallback_thumbnail(file_id, extension)
                
            # Resize image
            img = Image.open(temp_file)
            # Handle orientation
            try:
                # Exif orientation tag is 274
                exif = img._getexif()
                if exif and 274 in exif:
                    orientation = exif[274]
                    if orientation == 3: img = img.rotate(180, expand=True)
                    elif orientation == 6: img = img.rotate(270, expand=True)
                    elif orientation == 8: img = img.rotate(90, expand=True)
            except Exception:
                pass
                
            img.thumbnail((200, 200))
            # Save thumbnail as RGB JPG
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.save(cached_path, "JPEG", quality=80)
            
            # Clean up temp file
            os.remove(temp_file)
            return cached_path
            
        except Exception as e:
            print(f"Error generating thumbnail for {file_path}: {e}")
            if os.path.exists(temp_file):
                try: os.remove(temp_file)
                except Exception: pass
            return self._create_fallback_thumbnail(file_id, extension)

    def _create_fallback_thumbnail(self, file_id, extension):
        cached_path = os.path.join(CACHE_DIR, f"{file_id}.jpg")
        if os.path.exists(cached_path):
            return cached_path
            
        # Draw a nice placeholder card
        img = Image.new('RGB', (200, 200), color=(30, 30, 35))
        draw = ImageDraw.Draw(img)
        draw.rectangle([10, 10, 190, 190], outline=(70, 70, 75), width=1)
        
        is_video = extension.lower() in VIDEO_EXTENSIONS
        color = (13, 148, 136) if is_video else (140, 140, 145)
        
        # Draw a video play triangle or photo box
        if is_video:
            draw.polygon([(85, 75), (125, 100), (85, 125)], fill=color)
            draw.text((30, 150), f"VIDEO ({extension.upper()})", fill=(180, 180, 180))
        else:
            draw.rectangle([75, 75, 125, 125], fill=color)
            draw.text((30, 150), f"PHOTO ({extension.upper()})", fill=(180, 180, 180))
            
        img.save(cached_path, "JPEG")
        return cached_path
