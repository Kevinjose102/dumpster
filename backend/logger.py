import os
import json
from datetime import datetime

class TransactionLogger:
    def __init__(self, log_dir):
        self.log_dir = log_dir
        os.makedirs(self.log_dir, exist_ok=True)
        self.log_file = os.path.join(self.log_dir, "transactions.json")
        self.transactions = self._load_transactions()

    def _load_transactions(self):
        if os.path.exists(self.log_file):
            try:
                with open(self.log_file, "r") as f:
                    return json.load(f)
            except Exception:
                return []
        return []

    def _save_transactions(self):
        try:
            with open(self.log_file, "w") as f:
                json.dump(self.transactions, f, indent=4)
        except Exception as e:
            print(f"Error saving transactions log: {e}")

    def log_transaction(self, action_type, files, details=None):
        """
        action_type: 'archive' or 'delete' or 'restore'
        files: list of dicts with { 'original_path', 'destination_path', 'size', 'name', 'recovery_id' (optional) }
        details: dict containing metadata (device name, category, duration, etc.)
        """
        transaction_id = datetime.now().strftime("%Y%m%d%H%M%S") + f"_{len(self.transactions)}"
        transaction = {
            "id": transaction_id,
            "timestamp": datetime.now().isoformat(),
            "action": action_type,
            "file_count": len(files),
            "total_size": sum(f.get("size", 0) for f in files),
            "files": files,
            "details": details or {}
        }
        self.transactions.append(transaction)
        self._save_transactions()
        return transaction_id

    def get_last_transaction(self):
        if not self.transactions:
            return None
        return self.transactions[-1]

    def remove_last_transaction(self):
        if self.transactions:
            self.transactions.pop()
            self._save_transactions()

    def get_history(self, limit=50):
        # Return recent transactions first
        return list(reversed(self.transactions))[:limit]
