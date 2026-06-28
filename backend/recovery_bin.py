import os
import json
import uuid
import shutil
from datetime import datetime, timedelta

DEFAULT_RECOVERY_BIN_DIR = r"D:\Phone Archive\Recovery Bin"

class RecoveryBinManager:
    def __init__(self, recovery_bin_dir=None):
        if recovery_bin_dir is None:
            # Check if D:\ drive exists, otherwise fallback to User Profile
            if os.path.exists("D:\\"):
                self.recovery_bin_dir = DEFAULT_RECOVERY_BIN_DIR
            else:
                self.recovery_bin_dir = os.path.join(os.path.expanduser("~"), "PhoneArchive", "RecoveryBin")
        else:
            self.recovery_bin_dir = recovery_bin_dir
            
        os.makedirs(self.recovery_bin_dir, exist_ok=True)
        self.metadata_file = os.path.join(self.recovery_bin_dir, "metadata.json")
        self.metadata = self._load_metadata()
        
    def _load_metadata(self):
        if os.path.exists(self.metadata_file):
            try:
                with open(self.metadata_file, "r") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save_metadata(self):
        try:
            with open(self.metadata_file, "w") as f:
                json.dump(self.metadata, f, indent=4)
        except Exception as e:
            print(f"Error saving recovery bin metadata: {e}")

    def list_files(self):
        # Refresh metadata to ensure consistency
        self.metadata = self._load_metadata()
        return list(self.metadata.values())

    def add_file(self, file_name, original_path, original_device, size, category, source_copy_func):
        """
        Moves a file from MTP phone to PC Recovery Bin.
        source_copy_func: callable that takes (dest_local_path) and copies the file from phone to local path.
        Returns the created record.
        """
        file_id = str(uuid.uuid4())
        ext = os.path.splitext(file_name)[1]
        bin_file_name = f"{file_id}{ext}"
        bin_path = os.path.join(self.recovery_bin_dir, bin_file_name)
        
        try:
            # Execute the copy function (e.g. from MTP to PC)
            success = source_copy_func(bin_path)
            if not success or not os.path.exists(bin_path):
                raise IOError(f"Failed to copy file {file_name} to Recovery Bin.")
                
            # Create metadata record
            actual_size = size if size > 0 else os.path.getsize(bin_path)
            record = {
                "id": file_id,
                "name": file_name,
                "original_path": original_path,
                "original_device": original_device,
                "size": actual_size,
                "category": category,
                "deleted_at": datetime.now().isoformat(),
                "bin_path": bin_path
            }
            
            self.metadata[file_id] = record
            self._save_metadata()
            return record
            
        except Exception as e:
            if os.path.exists(bin_path):
                try:
                    os.remove(bin_path)
                except Exception:
                    pass
            raise e

    def restore_file(self, file_id, restore_func):
        """
        Restores a file back to the phone.
        restore_func: callable that takes (local_bin_path, original_phone_path) and copies it back.
        """
        if file_id not in self.metadata:
            raise KeyError(f"File ID {file_id} not found in Recovery Bin.")
            
        record = self.metadata[file_id]
        bin_path = record["bin_path"]
        original_path = record["original_path"]
        
        if not os.path.exists(bin_path):
            # File physically missing from recovery bin, remove metadata
            del self.metadata[file_id]
            self._save_metadata()
            raise FileNotFoundError(f"Physical file missing for recovery item: {bin_path}")
            
        try:
            # Call restore function
            success = restore_func(bin_path, original_path)
            if not success:
                raise IOError(f"Failed to restore file {record['name']} back to phone.")
                
            # Clean up local copy
            os.remove(bin_path)
            del self.metadata[file_id]
            self._save_metadata()
            return record
            
        except Exception as e:
            raise e

    def purge_file(self, file_id):
        """
        Permanently deletes a file from the Recovery Bin.
        """
        if file_id not in self.metadata:
            return False
            
        record = self.metadata[file_id]
        bin_path = record["bin_path"]
        
        if os.path.exists(bin_path):
            try:
                os.remove(bin_path)
            except Exception as e:
                print(f"Error deleting physical file {bin_path}: {e}")
                
        del self.metadata[file_id]
        self._save_metadata()
        return True

    def purge_all(self):
        """
        Permanently deletes all files in the Recovery Bin.
        """
        for file_id in list(self.metadata.keys()):
            self.purge_file(file_id)
        return True

    def clean_expired(self, retention_days):
        """
        Cleans up files older than the retention period.
        """
        now = datetime.now()
        expired_ids = []
        
        for file_id, record in self.metadata.items():
            try:
                deleted_at = datetime.fromisoformat(record["deleted_at"])
                if now - deleted_at > timedelta(days=retention_days):
                    expired_ids.append(file_id)
            except Exception:
                # If timestamp is corrupt, delete it for safety
                expired_ids.append(file_id)
                
        for file_id in expired_ids:
            self.purge_file(file_id)
            
        return len(expired_ids)
