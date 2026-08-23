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
from audio.audio import TTSWorker, play_audio, stop_audio
from audio.tts_elevenlabs import list_voices, is_configured, el_cfg
def show_el_settings(win):
    from audio.tts_elevenlabs import list_voices, is_configured
    dlg = win._dlg_base("🎙️ ElevenLabs Voice", w=460)
    lay = QVBoxLayout(dlg._content)

    hdr = QLabel("🎙️  ElevenLabs Expressive TTS")
    hdr.setStyleSheet(f"font-size:15px;font-weight:bold;color:{CYAN};padding:8px 0")
    hdr.setAlignment(Qt.AlignmentFlag.AlignCenter)
    lay.addWidget(hdr)

    status_lbl = QLabel("✅ Connected" if is_configured() else "⚠️ Not configured")
    status_lbl.setStyleSheet(f"color:{'#4caf50' if is_configured() else '#ff9800'};font-size:12px;font-weight:bold")
    status_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
    lay.addWidget(status_lbl)

    el = CONFIG.get("elevenlabs", {})
    form = QFormLayout(); form.setSpacing(10); form.setContentsMargins(16,8,16,8)

    e_key   = QLineEdit(el.get("api_key",  ""))
    e_key.setEchoMode(QLineEdit.EchoMode.Password)
    e_key.setPlaceholderText("sk_...")
    e_vid   = QLineEdit(el.get("voice_id", ""))
    e_vid.setPlaceholderText("e.g. 21m00Tcm4TlvDq8ikWAM")

    e_model = QComboBox()
    for m in ["eleven_turbo_v2_5", "eleven_turbo_v2", "eleven_multilingual_v2", "eleven_monolingual_v1"]:
        e_model.addItem(m)
    cur_m = el.get("model_id", "eleven_turbo_v2_5")
    idx = e_model.findText(cur_m)
    e_model.setCurrentIndex(idx if idx >= 0 else 0)

    win._field_row(form, "API Key",  e_key,   "From elevenlabs.io → Profile → API Keys")
    win._field_row(form, "Voice ID", e_vid,   "From Voice Library — click a voice → copy ID")
    win._field_row(form, "Model",    e_model, "eleven_turbo_v2_5 = fastest + emotional")
    lay.addLayout(form)

    # Voice fetch button
    voice_lbl = QLabel("")
    voice_lbl.setStyleSheet(f"color:{TXT2};font-size:11px;padding:0 16px")
    voice_lbl.setWordWrap(True)
    lay.addWidget(voice_lbl)

    fetch_btn = QPushButton("🔍  Fetch My Voices")
    fetch_btn.setStyleSheet(f"QPushButton{{background:{BG3};border:1px solid {PURPLE};border-radius:8px;padding:7px;color:{TXT1}}}QPushButton:hover{{background:rgba(192,132,252,0.15)}}")
    def _fetch():
        from audio.tts_elevenlabs import el_cfg
        # Temporarily save key so list_voices can use it
        CONFIG.setdefault("elevenlabs", {})["api_key"] = e_key.text().strip()
        voices = list_voices()
        if voices:
            lines = "\n".join(f"  {v['name']}  →  {v['voice_id']}" for v in voices[:10])
            voice_lbl.setText(f"Your voices:\n{lines}")
        else:
            voice_lbl.setText("No voices found — check your API key")
    fetch_btn.clicked.connect(_fetch)
    lay.addWidget(fetch_btn)

    # Emotion preview
    preview_row = QHBoxLayout()
    emo_pick = QComboBox()
    for e in ["excited","sad","angry","love","evil","sleepy","mocking","blush"]:
        emo_pick.addItem(e)
    test_btn = QPushButton("▶  Test Voice")
    test_btn.setStyleSheet(f"QPushButton{{background:{BG3};border:1px solid {PINK};border-radius:8px;padding:7px;color:{TXT1}}}QPushButton:hover{{background:rgba(255,107,157,0.15)}}")
    _el_test_ref = []   # prevent GC
    def _test():
        from audio.audio import TTSWorker, play_audio, stop_audio
        stop_audio()
        sample = f"Hey! I am your companion. Right now I am feeling {emo_pick.currentText()}~"
        w = TTSWorker(sample, engine="elevenlabs",
                      emotion=emo_pick.currentText())
        w.done.connect(play_audio)
        w.done.connect(lambda _: w.wait(1000))
        w.failed.connect(lambda e: voice_lbl.setText(f"Test failed: {e}"))
        _el_test_ref.clear()
        _el_test_ref.append(w)
        w.start()
    test_btn.clicked.connect(_test)
    preview_row.addWidget(QLabel("Test emotion:")); preview_row.addWidget(emo_pick); preview_row.addWidget(test_btn)
    preview_lw = QWidget(); preview_lw.setLayout(preview_row)
    lay.addWidget(preview_lw)

    hint = QLabel("💡  ElevenLabs overrides edge-tts and piper when API key + voice ID are set.")
    hint.setStyleSheet(f"color:{PURPLE};font-size:11px;font-style:italic;padding:4px 16px")
    hint.setWordWrap(True)
    lay.addWidget(hint)

    lay.addSpacing(8)

    def _save():
        CONFIG["elevenlabs"] = {
            "api_key":  e_key.text().strip(),
            "voice_id": e_vid.text().strip(),
            "model_id": e_model.currentText(),
        }
        save_config()
        dlg.accept()
        win._display("*clears throat* ElevenLabs configured! [EMOTION: happy] 🎙️")

    win._save_btn(dlg, lay, _save)
    dlg.show()
