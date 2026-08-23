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
def show_theme_picker(win):
    dlg = win._dlg_base("🎨  Theme", w=420, h=560)
    t = TH._active
    lay = QVBoxLayout(dlg._content); lay.setContentsMargins(16,16,16,16); lay.setSpacing(8)

    hdr = QLabel("🎨  Choose Your Theme")
    hdr.setStyleSheet(f"font-size:15px;font-weight:bold;color:{t['ACC3']};padding-bottom:4px")
    hdr.setAlignment(Qt.AlignmentFlag.AlignCenter); lay.addWidget(hdr)

    sub = QLabel("Changes apply instantly — no restart needed.")
    sub.setStyleSheet(f"font-size:11px;color:{t['TXT2']};letter-spacing:1px")
    sub.setAlignment(Qt.AlignmentFlag.AlignCenter); lay.addWidget(sub)
    lay.addSpacing(4)

    # ── Scrollable theme list ────────────────────────────────────────────
    from PyQt6.QtWidgets import QScrollArea
    scroll = QScrollArea()
    scroll.setWidgetResizable(True)
    scroll.setFrameShape(QFrame.Shape.NoFrame)
    scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
    scroll.setStyleSheet(f"""
        QScrollArea {{ background:transparent; border:none; }}
        QScrollBar:vertical {{
            background:{t['BG2']}; width:6px; border-radius:3px;
        }}
        QScrollBar::handle:vertical {{
            background:{t['ACC2']}; border-radius:3px; min-height:20px;
        }}
        QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height:0px; }}
    """)

    inner = QWidget(); inner.setStyleSheet("background:transparent")
    inner_lay = QVBoxLayout(inner)
    inner_lay.setContentsMargins(0, 0, 8, 0); inner_lay.setSpacing(6)

    cur = win.sd.get("theme", TH.DEFAULT_THEME)
    for name, data in TH.THEMES.items():
        row = QHBoxLayout(); row.setSpacing(10)

        # Color swatch gradient strip
        sw_frame = QFrame(); sw_frame.setFixedSize(52, 36)
        sw_frame.setStyleSheet(
            f"background:qlineargradient(x1:0,y1:0,x2:1,y2:1,"
            f"stop:0 {data['ACC1']},stop:0.5 {data['ACC2']},stop:1 {data['ACC3']});"
            f"border-radius:8px;border:none"
        )
        row.addWidget(sw_frame)

        is_cur = (name == cur)
        btn = QPushButton(data["label"] + ("  ✓" if is_cur else ""))
        btn.setFixedHeight(36)
        if is_cur:
            btn.setStyleSheet(
                f"QPushButton{{background:{t['GLOW']};border:1px solid {t['ACC1']};"
                f"border-radius:10px;padding:0 12px;color:{t['ACC1']};"
                f"font-size:13px;text-align:left}}"
            )
        else:
            btn.setStyleSheet(
                f"QPushButton{{background:{t['BG3']};border:1px solid {t['BORDER']};"
                f"border-radius:10px;padding:0 12px;color:{t['TXT1']};"
                f"font-size:13px;text-align:left}}"
                f"QPushButton:hover{{background:{t['BG4']};border-color:{t['ACC2']}}}"
            )

        def _make_cb(n):
            def cb():
                win._apply_theme_and_save(n)
                dlg.accept()
            return cb
        btn.clicked.connect(_make_cb(name))
        row.addWidget(btn, 1)
        inner_lay.addLayout(row)

    inner_lay.addStretch()
    scroll.setWidget(inner)
    lay.addWidget(scroll, 1)   # stretch=1 so scroll fills remaining space

    close_btn = QPushButton("✕  Close")
    close_btn.setFixedHeight(36)
    close_btn.setStyleSheet(
        f"QPushButton{{background:{t['BG3']};border:1px solid {t['BORDER']};"
        f"border-radius:10px;color:{t['TXT2']};font-size:13px}}"
        f"QPushButton:hover{{background:{t['BG4']};color:{t['TXT1']}}}"
    )
    close_btn.clicked.connect(dlg.accept)
    lay.addWidget(close_btn)
    dlg.show()
