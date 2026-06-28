import os
import sys
import time
import threading
import socket
from PySide6.QtCore import QUrl
from PySide6.QtWidgets import QApplication, QMainWindow
from PySide6.QtWebEngineWidgets import QWebEngineView

from app import app as flask_app

PORT = 5000

def run_flask():
    # Runs the Flask server on a separate thread
    # Setting debug=False is important when running on a thread to prevent duplicate processes
    flask_app.run(port=PORT, debug=False, use_reloader=False, host="127.0.0.1", threaded=True)

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Android Media Cleanup Manager")
        self.resize(1280, 800)
        
        # Make the window start maximized
        self.showMaximized()
        
        self.browser = QWebEngineView()
        self.setCentralWidget(self.browser)
        
        # Load the local Flask web app
        self.browser.setUrl(QUrl(f"http://127.0.0.1:{PORT}/"))

def wait_for_port(port, host="127.0.0.1", timeout=5.0):
    start_time = time.time()
    while True:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            if time.time() - start_time > timeout:
                return False
            time.sleep(0.1)

def main():
    # 1. Start Flask in a background thread
    server_thread = threading.Thread(target=run_flask)
    server_thread.daemon = True
    server_thread.start()
    
    # Wait for the Flask server to be ready before showing MainWindow
    wait_for_port(PORT, timeout=10.0)
    
    # 2. Run PySide6 Application
    qt_app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    
    sys.exit(qt_app.exec())

if __name__ == "__main__":
    main()
