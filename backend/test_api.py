import os
import sys
import time
import unittest
import json
import threading
from urllib.request import urlopen, Request

# Import the Flask application
sys.path.append(os.path.dirname(__file__))
from app import app as flask_app, SETTINGS_FILE
from mtp_manager import MOCK_PHONE_DIR

PORT = 5055

def run_server():
    flask_app.run(port=PORT, debug=False, use_reloader=False)

class TestCleanupManagerAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Start server in a background thread
        cls.server_thread = threading.Thread(target=run_server)
        cls.server_thread.daemon = True
        cls.server_thread.start()
        time.sleep(1.5)  # Wait for boot

    def make_request(self, path, method="GET", data=None):
        url = f"http://127.0.0.1:{PORT}{path}"
        req_data = None
        headers = {}
        
        if data is not None:
            req_data = json.dumps(data).encode("utf-8")
            headers = {"Content-Type": "application/json"}
            
        req = Request(url, data=req_data, headers=headers, method=method)
        try:
            with urlopen(req) as res:
                return res.status, json.loads(res.read().decode("utf-8"))
        except Exception as e:
            # For debugging, print body if available
            if hasattr(e, 'read'):
                print("Error response body:", e.read().decode("utf-8"))
            raise e

    def test_01_devices(self):
        print("Testing GET /api/devices...")
        status, data = self.make_request("/api/devices")
        self.assertEqual(status, 200)
        self.assertTrue(len(data) > 0)
        self.assertIn("id", data[0])
        self.assertIn("type", data[0])
        self.assertIn(data[0]["type"], ["mock", "physical"])

    def test_02_scan(self):
        print("Testing POST /api/scan...")
        status, data = self.make_request("/api/scan", "POST", {
            "device_id": "mock_device_simulator",
            "device_name": "Simulated Android Phone (Demo)"
        })
        self.assertEqual(status, 200)
        self.assertTrue(len(data) > 0)
        self.assertIn("original_path", data[0])
        self.assertIn("category", data[0])
        
        # Verify categorizations
        categories = {f["category"] for f in data}
        print(f"Discovered categories in scan: {categories}")
        self.assertTrue(len(categories) > 0)

    def test_03_status(self):
        print("Testing GET /api/status...")
        status, data = self.make_request("/api/status")
        self.assertEqual(status, 200)
        self.assertEqual(data["device_id"], "mock_device_simulator")
        self.assertTrue(data["is_mock"])
        self.assertIn("stats", data)
        self.assertEqual(data["stats"]["moved"], 0)

    def test_04_archive_and_undo(self):
        print("Testing Archive operation...")
        # 1. Scan to get files
        _, files = self.make_request("/api/scan", "POST", {
            "device_id": "mock_device_simulator"
        })
        
        # Pick 2 screenshots to archive
        screenshots = [f for f in files if f["category"] == "Screenshots"]
        if not screenshots:
            self.skipTest("No screenshots to test archiving")
            
        test_file = screenshots[0]
        test_ids = [test_file["id"]]
        
        # Perform Archive
        status, data = self.make_request("/api/archive", "POST", {
            "file_ids": test_ids
        })
        self.assertEqual(status, 200)
        self.assertEqual(data["success_count"], 1)
        self.assertEqual(len(data["failed_files"]), 0)
        
        # Verify the archived local file exists on PC
        settings_status, settings_data = self.make_request("/api/settings")
        dest_dir = settings_data["destinations"]["Screenshots"]
        expected_pc_path = os.path.join(dest_dir, test_file["name"])
        self.assertTrue(os.path.exists(expected_pc_path), f"Archived file not found on PC: {expected_pc_path}")
        
        # 2. Test Undo Last Action
        print("Testing Undo for Archive operation...")
        status, undo_data = self.make_request("/api/undo", "POST")
        self.assertEqual(status, 200)
        self.assertEqual(undo_data["action_undone"], "archive")
        self.assertEqual(undo_data["success_count"], 1)
        
        # Verify that archived file was deleted from PC and put back to phone
        self.assertFalse(os.path.exists(expected_pc_path), "Local archive copy should be deleted on undo")
        self.assertTrue(os.path.exists(test_file["original_path"]), "Original file should be restored on phone")

    def test_05_delete_and_restore(self):
        print("Testing Delete (Recovery Bin) operation...")
        _, files = self.make_request("/api/scan", "POST", {
            "device_id": "mock_device_simulator"
        })
        
        camera_photos = [f for f in files if f["category"] == "Camera Photos"]
        if not camera_photos:
            self.skipTest("No camera photos to test deletion")
            
        test_file = camera_photos[0]
        test_ids = [test_file["id"]]
        
        # Perform Delete (Moves to recovery bin)
        status, data = self.make_request("/api/delete", "POST", {
            "file_ids": test_ids
        })
        self.assertEqual(status, 200)
        self.assertEqual(data["success_count"], 1)
        
        # Verify original file deleted from mock phone
        self.assertFalse(os.path.exists(test_file["original_path"]), "Original file should be removed from phone on delete")
        
        # Get Recovery Bin listing
        status, bin_files = self.make_request("/api/recovery-bin")
        self.assertEqual(status, 200)
        self.assertTrue(len(bin_files) > 0)
        
        recovery_rec = [f for f in bin_files if f["name"] == test_file["name"]][0]
        self.assertTrue(os.path.exists(recovery_rec["bin_path"]), "Backup copy should exist in local Recovery Bin")
        
        # Perform Restore
        print("Testing Restore from Recovery Bin...")
        status, restore_data = self.make_request("/api/recovery-bin/restore", "POST", {
            "recovery_ids": [recovery_rec["id"]]
        })
        self.assertEqual(status, 200)
        self.assertEqual(restore_data["success_count"], 1)
        
        # Verify restored back to mock phone
        self.assertTrue(os.path.exists(test_file["original_path"]), "Restored file should reappear on phone")
        self.assertFalse(os.path.exists(recovery_rec["bin_path"]), "Backup copy should be cleaned from Recovery Bin")

if __name__ == "__main__":
    unittest.main()
