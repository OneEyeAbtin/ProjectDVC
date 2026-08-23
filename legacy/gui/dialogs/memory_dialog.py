"""Extracted from core/main.py."""

import gui.theme as TH
from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QProgressBar, QLineEdit, QCheckBox, QComboBox, QSpinBox,
    QFormLayout, QSlider, QTextEdit, QListWidget, QListWidgetItem,
    QTabWidget, QFrame, QScrollArea, QMessageBox, QDialog, QSizePolicy,
    QFileDialog, QGroupBox)
from PyQt6.QtCore import Qt, QTimer, QPoint, QPropertyAnimation, QEasingCurve, QObject, pyqtSignal
from PyQt6.QtGui import QColor, QPalette, QLinearGradient, QBrush

def show_memory_dialog(win):
    th = TH._active
    dlg = win._dlg_base("🧠 Memory", w=380, h=420)
    lay = QVBoxLayout(dlg._content)
    hdr = QLabel("🧠  Memory")
    hdr.setAlignment(Qt.AlignmentFlag.AlignCenter)
    hdr.setStyleSheet(f"font-size:14px;font-weight:bold;color:{th['ACC3']};padding:8px 0")
    lay.addWidget(hdr)
    sc = QScrollArea(); sc.setWidgetResizable(True)
    sc.setStyleSheet("background:transparent;border:none")
    inn = QWidget(); il = QVBoxLayout(inn); il.setSpacing(2)
    entries = win.traits or []
    if entries:
        for tr in entries:
            l = QLabel(f"  {tr}"); l.setWordWrap(True)
            l.setStyleSheet(
                f"color:{th['TXT2']};font-size:11px;padding:5px 8px;"
                f"border-bottom:1px solid {th['BORDER']};border-radius:4px"
            )
            il.addWidget(l)
    else:
        l = QLabel("No memories yet...")
        l.setAlignment(Qt.AlignmentFlag.AlignCenter)
        l.setStyleSheet(f"color:{th['TXT2']};font-style:italic;padding:20px")
        il.addWidget(l)
    il.addStretch(); sc.setWidget(inn); lay.addWidget(sc, 1)
    win._save_btn(dlg, lay, dlg.accept)
    dlg.show()
