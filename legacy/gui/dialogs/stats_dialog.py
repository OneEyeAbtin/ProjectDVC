"""Extracted from core/main.py."""

import gui.theme as TH
from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QProgressBar, QLineEdit, QCheckBox, QComboBox, QSpinBox,
    QFormLayout, QSlider, QTextEdit, QListWidget, QListWidgetItem,
    QTabWidget, QFrame, QScrollArea, QMessageBox, QDialog, QSizePolicy,
    QFileDialog, QGroupBox)
from PyQt6.QtCore import Qt, QTimer, QPoint, QPropertyAnimation, QEasingCurve, QObject, pyqtSignal
from PyQt6.QtGui import QColor, QPalette, QLinearGradient, QBrush

from core.save import persist_save
from audio.audio import play_sfx
def show_stats_dialog(win):
    from PyQt6.QtWidgets import QProgressBar as PB
    th = TH._active
    b1=th["BG1"]; b3=th["BG3"]; bd=th["BORDER"]
    a1=th["ACC1"]; a2=th["ACC2"]; a3=th["ACC3"]
    tx1=th["TXT1"]; tx2=th["TXT2"]

    dlg = win._dlg_base("📊 Stats", w=400)
    lay = QVBoxLayout(dlg._content)
    hdr = QLabel("📊  Stats")
    hdr.setAlignment(Qt.AlignmentFlag.AlignCenter)
    hdr.setStyleSheet(f"font-size:16px;font-weight:bold;color:{a3};padding:8px 0")
    lay.addWidget(hdr)

    for sn, sv in win.sd["stats"].items():
        row = QHBoxLayout(); row.setSpacing(8)
        lbl = QLabel(sn.capitalize())
        lbl.setStyleSheet(f"color:{tx2};font-size:12px;min-width:80px")
        row.addWidget(lbl)
        minus = QPushButton("➖"); minus.setFixedSize(30, 30)
        minus.setProperty("class","stat-minus")
        minus.setStyleSheet("QPushButton{background:#c0392b;border:none;border-radius:7px;color:white;font-size:14px;padding:0}QPushButton:hover{background:#e74c3c}")
        row.addWidget(minus)
        # Bar color based on value
        bc = a2 if sv > 70 else a1 if sv > 40 else "#e74c3c"
        bar = PB(); bar.setRange(0,100); bar.setValue(sv); bar.setFixedHeight(10); bar.setTextVisible(False)
        bar.setStyleSheet(f"QProgressBar{{background:{b3};border:none;border-radius:5px}}QProgressBar::chunk{{background:{bc};border-radius:5px}}")
        row.addWidget(bar, 1)
        plus = QPushButton("➕"); plus.setFixedSize(30, 30)
        plus.setProperty("class","stat-plus")
        plus.setStyleSheet("QPushButton{background:#27ae60;border:none;border-radius:7px;color:white;font-size:14px;padding:0}QPushButton:hover{background:#2ecc71}")
        row.addWidget(plus)
        vlbl = QLabel(str(sv))
        vlbl.setStyleSheet(f"color:{a1};font-size:12px;font-weight:bold;min-width:30px")
        vlbl.setAlignment(Qt.AlignmentFlag.AlignRight); row.addWidget(vlbl)
        def _cb(stat, delta, b, vl):
            def cb():
                win.sd["stats"][stat] = max(0, min(100, win.sd["stats"][stat] + delta))
                nv = win.sd["stats"][stat]; b.setValue(nv); vl.setText(str(nv))
                th2 = TH._active
                nc = th2["ACC2"] if nv > 70 else th2["ACC1"] if nv > 40 else "#e74c3c"
                b.setStyleSheet(f"QProgressBar{{background:{th2['BG3']};border:none;border-radius:5px}}QProgressBar::chunk{{background:{nc};border-radius:5px}}")
                persist_save(win.sd); win._upd_hearts()
                play_sfx("stat_up.wav" if delta > 0 else "stat_down.wav")
            return cb
        minus.clicked.connect(_cb(sn, -5, bar, vlbl))
        plus.clicked.connect(_cb(sn,  5, bar, vlbl))
        lay.addLayout(row)
    win._save_btn(dlg, lay, dlg.accept)
    dlg.show()
