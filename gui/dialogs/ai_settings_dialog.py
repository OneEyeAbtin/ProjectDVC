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
def show_ai_settings(win):
    dlg  = win._dlg_base("🌐 AI / API Settings", w=460)
    lay  = QVBoxLayout(dlg._content)

    hdr  = QLabel("🌐  AI / API Settings")
    hdr.setStyleSheet(f"font-size:15px;font-weight:bold;color:{CYAN};padding:8px 0")
    hdr.setAlignment(Qt.AlignmentFlag.AlignCenter)
    lay.addWidget(hdr)

    # ── Brain mode quick-switch ───────────────────────────────────────────
    bm_row = QHBoxLayout(); bm_row.setSpacing(8)
    bm_lbl = QLabel("🧠 Active Brain:")
    bm_lbl.setStyleSheet(f"color:{TXT1};font-size:12px;font-weight:bold")
    bm_row.addWidget(bm_lbl); bm_row.addStretch()
    cur_bm  = win.sd.get("brain_mode", "local")
    bm_btns = {}
    for bv, bl in [("local","🖥 Local"),("online","🌐 Online"),("offline","💾 Offline")]:
        btn = QPushButton(bl); btn.setCheckable(True); btn.setChecked(bv == cur_bm)
        btn.setFixedHeight(30)
        btn.setStyleSheet(
            f"QPushButton{{background:{BG3};border:1px solid {_c('BORDER')};"
            f"border-radius:8px;padding:0 12px;font-size:11px;color:{TXT2}}}"
            f"QPushButton:checked{{background:{PURPLE};border-color:{PURPLE};"
            f"color:white;font-weight:bold}}"
            f"QPushButton:hover{{border-color:{PINK};color:{PINK}}}"
        )
        bm_btns[bv] = btn; bm_row.addWidget(btn)
    def _set_bm(v):
        win.sd["brain_mode"] = v; persist_save(win.sd); win._upd_brain()
        for k, b in bm_btns.items(): b.setChecked(k == v)
    for bv, btn in bm_btns.items():
        btn.clicked.connect(lambda _, v=bv: _set_bm(v))
    bm_w = QWidget(); bm_w.setLayout(bm_row)
    lay.addWidget(bm_w)

    div = QFrame(); div.setFixedHeight(1)
    div.setStyleSheet(f"background:{_c('BORDER')};margin:4px 0")
    lay.addWidget(div)

    tabs = QTabWidget(); lay.addWidget(tabs, 1)

    # ── Tab: Local (LM Studio) ────────────────────────────────────────────
    tp_local = QWidget(); fl = QFormLayout(tp_local); fl.setSpacing(10); fl.setContentsMargins(16,16,16,8)
    e_lurl  = QLineEdit(CONFIG.get("local_api_url",  "http://localhost:1234/v1/chat/completions"))
    e_lkey_w, e_lkey = win._eye_field("Leave blank for LM Studio", CONFIG.get("local_api_key",""))
    e_lmdl  = QLineEdit(CONFIG.get("local_api_model","local-model"))
    win._field_row(fl, "API URL",   e_lurl,  "LM Studio server URL")
    win._field_row(fl, "API Key",   e_lkey_w,  "Leave blank for LM Studio")
    win._field_row(fl, "Model",     e_lmdl,  "Model name / identifier")
    tabs.addTab(tp_local, "🖥  Local")

    # ── Tab: Online (OpenAI / Groq) ───────────────────────────────────────
    tp_onl  = QWidget(); fo = QFormLayout(tp_onl); fo.setSpacing(10); fo.setContentsMargins(16,16,16,8)
    e_ourl  = QLineEdit(CONFIG.get("online_api_url",  "https://api.openai.com/v1/chat/completions"))
    e_okey_w, e_okey = win._eye_field("Paste your API key...", CONFIG.get("online_api_key",""))
    e_omdl  = QLineEdit(CONFIG.get("online_api_model","gpt-4o-mini"))
    win._field_row(fo, "API URL",   e_ourl,  "OpenAI / Groq / any OpenAI-compat URL")
    win._field_row(fo, "API Key",   e_okey_w,  "Your API key")
    win._field_row(fo, "Model",     e_omdl,  "e.g. gpt-4o, llama-3.3-70b-versatile")
    tabs.addTab(tp_onl, "🌐  Online")

    lay.addSpacing(8)

    def _save():
        CONFIG["local_api_url"]    = e_lurl.text().strip()
        CONFIG["local_api_key"]    = e_lkey.text().strip()
        CONFIG["local_api_model"]  = e_lmdl.text().strip()
        CONFIG["online_api_url"]   = e_ourl.text().strip()
        CONFIG["online_api_key"]   = e_okey.text().strip()
        CONFIG["online_api_model"] = e_omdl.text().strip()
        save_config()
        dlg.accept()
        win._display("*reconfiguring* API settings saved! [EMOTION: happy] 💾")

    win._save_btn(dlg, lay, _save)
    dlg.show()
