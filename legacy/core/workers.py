"""
[MODULE] workers.py
[SYSTEM] ProjectDVC — QThread worker pool. Fires AI API requests off the main
         thread so the UI never freezes. Emits finished/error signals back
         to CompanionWindow on completion.
[AUTHOR] Abtin

Copyright (c) 2026 Abtin (github.com/OneEyeAbtin). All rights reserved.
This code may not be copied, modified, or distributed without permission.
"""
import requests
from PyQt6.QtCore import QThread, pyqtSignal

class AIWorker(QThread):
    finished = pyqtSignal(str)
    error    = pyqtSignal(str)

    def __init__(self, msgs, url, key, model, parent=None):
        super().__init__(parent)
        self.msgs, self.url, self.key, self.model = msgs, url, key, model

    def run(self):
        try:
            headers = {"Content-Type": "application/json"}
            if self.key:
                headers["Authorization"] = f"Bearer {self.key}"
            r = requests.post(
                self.url,
                json={"model": self.model, "messages": self.msgs,
                      "temperature": 0.85, "max_tokens": 300, "stream": False},
                headers=headers, timeout=30,
            )
            r.raise_for_status()
            self.finished.emit(r.json()["choices"][0]["message"]["content"])
        except Exception as e:
            self.error.emit(str(e))
