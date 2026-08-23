"""Extracted from core/main.py."""

import gui.theme as TH
from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QProgressBar, QLineEdit, QCheckBox, QComboBox, QSpinBox,
    QFormLayout, QSlider, QTextEdit, QListWidget, QListWidgetItem,
    QTabWidget, QFrame, QScrollArea, QMessageBox, QDialog, QSizePolicy,
    QFileDialog, QGroupBox)
from PyQt6.QtCore import Qt, QTimer, QPoint, QPropertyAnimation, QEasingCurve, QObject, pyqtSignal
from PyQt6.QtGui import QColor, QPalette, QLinearGradient, QBrush

from core.config import CONFIG, save_config
def show_msg_limit(win):
    dlg = win._dlg_base("💬 Message / Memory Limit", w=400, h=260)
    lay = QVBoxLayout(dlg._content)

    hdr = QLabel("💬  Conversation Message Limit")
    hdr.setStyleSheet(f"font-size:15px;font-weight:bold;color:{CYAN};padding:8px 0")
    hdr.setAlignment(Qt.AlignmentFlag.AlignCenter)
    lay.addWidget(hdr)

    desc = QLabel(
        "Controls how many messages the AI remembers in a single conversation.\n"
        "Higher = better memory, but uses more tokens per request.\n"
        "Recommended: 20-40 for local models, up to 100 for large online models."
    )
    desc.setWordWrap(True)
    desc.setStyleSheet(f"color:{TXT2};font-size:12px;padding:4px 8px")
    lay.addWidget(desc)

    lay.addSpacing(6)

    cur = CONFIG.get("max_history", 20)
    val_lbl = QLabel(f"Current limit:  {cur} messages")
    val_lbl.setStyleSheet(f"color:{PINK};font-size:14px;font-weight:bold")
    val_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
    lay.addWidget(val_lbl)

    slider = QSlider(Qt.Orientation.Horizontal)
    slider.setRange(5, 200); slider.setValue(cur); slider.setTickInterval(10)
    slider.setTickPosition(QSlider.TickPosition.TicksBelow)
    lay.addWidget(slider)

    range_lbl = QLabel("5  ←————————————→  200")
    range_lbl.setStyleSheet(f"color:{TXT2};font-size:10px")
    range_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
    lay.addWidget(range_lbl)

    def _on_slide(v):
        val_lbl.setText(f"Current limit:  {v} messages")
    slider.valueChanged.connect(_on_slide)

    lay.addSpacing(8)

    def _save():
        CONFIG["max_history"] = slider.value()
        save_config()
        dlg.accept()
        win._display(f"Memory limit set to {slider.value()} messages! [EMOTION: thinking] 🧠")

    win._save_btn(dlg, lay, _save)
    dlg.show()
