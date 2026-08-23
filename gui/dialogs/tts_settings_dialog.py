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
from core.save import persist_save
from audio.audio import TTSWorker, play_audio, stop_audio, PIPER_MODELS, scan_piper_models, get_voice_path
def show_tts_settings(win):
    dlg = win._dlg_base("🔊 TTS Settings", w=480)
    lay = QVBoxLayout(dlg._content)

    hdr = QLabel("🔊  Text-to-Speech Settings")
    hdr.setStyleSheet(f"font-size:15px;font-weight:bold;color:{CYAN};padding:8px 0")
    hdr.setAlignment(Qt.AlignmentFlag.AlignCenter)
    lay.addWidget(hdr)

    # ── Piper voice quick-switch (only if voices exist) ───────────────────
    if PIPER_MODELS:
        vrow = QHBoxLayout(); vrow.setSpacing(8)
        vrow.addWidget(QLabel("🎤"))
        cv = win.sd.get("selected_offline_voice", "")
        vbox = QComboBox()
        for vn in sorted(PIPER_MODELS):
            vbox.addItem(vn)
            if vn == cv: vbox.setCurrentText(vn)
        vbox.setFixedHeight(30)
        def _qv_change(idx):
            vn = vbox.currentText()
            win.sd["selected_offline_voice"] = vn
            if not win.sd.get("tts_enabled"):
                win.sd["tts_enabled"] = True; win.sd["tts_engine"] = "offline"
            persist_save(win.sd)
        vbox.currentIndexChanged.connect(_qv_change)
        vrow.addWidget(vbox, 1)
        rescan_q = QPushButton("🔄")
        rescan_q.setFixedSize(30, 30)
        rescan_q.setToolTip("Rescan voices folder")
        rescan_q.clicked.connect(lambda: (scan_piper_models(),
            [vbox.addItem(n) for n in sorted(PIPER_MODELS) if vbox.findText(n) < 0]))
        vrow.addWidget(rescan_q)
        vrow_w = QWidget(); vrow_w.setLayout(vrow)
        lay.addWidget(vrow_w)
        div2 = QFrame(); div2.setFixedHeight(1)
        div2.setStyleSheet(f"background:{_c('BORDER')};margin:2px 0")
        lay.addWidget(div2)

    tabs = QTabWidget(); lay.addWidget(tabs, 1)

    # ── Tab: General ──────────────────────────────────────────────────────
    tp_gen = QWidget(); fg = QFormLayout(tp_gen)
    fg.setSpacing(12); fg.setContentsMargins(16, 16, 16, 8)

    # TTS on/off
    chk_enabled = QCheckBox("Enable TTS")
    chk_enabled.setChecked(win.sd.get("tts_enabled", False))
    chk_enabled.setStyleSheet(f"color:{TXT1};font-size:13px;font-weight:bold")
    fg.addRow(chk_enabled)

    # Lip-sync toggles
    chk_lipsync_tts = QCheckBox("🎙️  Lip-sync during TTS playback  (opens/closes mouth while speaking)")
    chk_lipsync_tts.setChecked(win.sd.get("lip_sync_tts", True))
    chk_lipsync_tts.setStyleSheet(f"color:{TXT1};font-size:12px")
    fg.addRow(chk_lipsync_tts)

    chk_lipsync_txt = QCheckBox("💬  Lip-sync during text typing  (mouth moves per word, no TTS needed)")
    chk_lipsync_txt.setChecked(win.sd.get("lip_sync_text", False))
    chk_lipsync_txt.setStyleSheet(f"color:{TXT1};font-size:12px")
    fg.addRow(chk_lipsync_txt)
    fg.addRow(QLabel(""))  # spacer

    # Engine picker
    engine_lbl = QLabel("Engine:")
    engine_box = QComboBox()

    # Detect what's available
    try:
        from audio.tts_elevenlabs import is_configured
        el_ok = is_configured()
    except ImportError:
        el_ok = False

    engines = [
        ("elevenlabs", f"🎙️  ElevenLabs  {'✅' if el_ok else '(not configured)'}"),
        ("online",     "🌐  edge-tts  (free, online)"),
        ("offline",    "💾  Piper  (offline, local)"),
    ]
    for val, label in engines:
        engine_box.addItem(label, userData=val)

    # Set current
    cur_eng = win.sd.get("tts_engine", "online")
    for i in range(engine_box.count()):
        if engine_box.itemData(i) == cur_eng:
            engine_box.setCurrentIndex(i); break

    fg.addRow(engine_lbl, engine_box)

    # edge-tts voice
    voice_lbl = QLabel("edge-tts Voice:")
    voice_box = QComboBox()
    edge_voices = [
        ("en-US-AriaNeural",    "Aria — US English, warm"),
        ("en-US-JennyNeural",   "Jenny — US English, friendly"),
        ("en-US-SaraNeural",    "Sara — US English, cheerful"),
        ("en-GB-SoniaNeural",   "Sonia — British English"),
        ("en-AU-NatashaNeural", "Natasha — Australian English"),
        ("ja-JP-NanamiNeural",  "Nanami — Japanese"),
        ("ko-KR-SunHiNeural",   "SunHi — Korean"),
    ]
    for val, label in edge_voices:
        voice_box.addItem(label, userData=val)
    cur_voice = CONFIG.get("tts", {}).get("online_voice", "en-US-AriaNeural")
    for i in range(voice_box.count()):
        if voice_box.itemData(i) == cur_voice:
            voice_box.setCurrentIndex(i); break

    fg.addRow(voice_lbl, voice_box)

    # Show/hide voice box based on engine
    def _on_engine_change(idx):
        val = engine_box.itemData(idx)
        voice_lbl.setVisible(val == "online")
        voice_box.setVisible(val == "online")
    engine_box.currentIndexChanged.connect(_on_engine_change)
    _on_engine_change(engine_box.currentIndex())

    tabs.addTab(tp_gen, "⚙️  General")

    # ── Tab: ElevenLabs ───────────────────────────────────────────────────
    tp_el = QWidget(); fel = QFormLayout(tp_el)
    fel.setSpacing(12); fel.setContentsMargins(16, 16, 16, 8)

    el = CONFIG.get("elevenlabs", {})
    e_key_w, e_key = win._eye_field("Paste your ElevenLabs API key...", el.get("api_key", ""))
    e_vid = QLineEdit(el.get("voice_id", ""))
    e_vid.setPlaceholderText("e.g. 21m00Tcm4TlvDq8ikWAM")

    el_model = QComboBox()
    # eleven_flash_v2_5 = current free tier | turbo_v2_5 = paid
    for m in ["eleven_flash_v2_5", "eleven_flash_v2",
              "eleven_turbo_v2_5", "eleven_turbo_v2",
              "eleven_multilingual_v2"]:
        el_model.addItem(m)
    cur_m = el.get("model_id", "eleven_turbo_v2_5")
    idx = el_model.findText(cur_m)
    el_model.setCurrentIndex(idx if idx >= 0 else 0)

    win._field_row(fel, "API Key",  e_key_w, "elevenlabs.io → Profile → API Keys")
    win._field_row(fel, "Voice ID", e_vid,   "Voice Library → click voice → copy ID")
    win._field_row(fel, "Model",    el_model, "eleven_turbo_v2_5 = fastest + emotional")

    voice_result = QLabel("")
    voice_result.setStyleSheet(f"color:{TXT2};font-size:10px")
    voice_result.setWordWrap(True)
    fel.addRow(voice_result)

    fetch_btn = QPushButton("🔍  Fetch My Voices")
    fetch_btn.setStyleSheet(
        f"QPushButton{{background:{BG3};border:1px solid {PURPLE};border-radius:8px;"
        f"padding:7px;color:{TXT1}}}QPushButton:hover{{background:rgba(192,132,252,0.15)}}"
    )
    def _fetch():
        CONFIG.setdefault("elevenlabs", {})["api_key"] = e_key.text().strip()
        try:
            from audio.tts_elevenlabs import list_voices
            voices = list_voices()
            if voices:
                lines = "\n".join(f"{v['name']}  →  {v['voice_id']}" for v in voices[:8])
                voice_result.setText(lines)
            else:
                voice_result.setText("No voices found — check your key")
        except Exception as ex:
            voice_result.setText(f"Error: {ex}")
    fetch_btn.clicked.connect(_fetch)
    fel.addRow(fetch_btn)

    # Test button
    test_row = QHBoxLayout()
    emo_box = QComboBox()
    for e in ["excited","sad","angry","love","evil","sleepy","mocking","blush","shocked"]:
        emo_box.addItem(e)
    test_btn = QPushButton("▶  Test")
    test_btn.setStyleSheet(
        f"QPushButton{{background:{BG3};border:1px solid {PINK};border-radius:8px;"
        f"padding:7px 14px;color:{TXT1}}}QPushButton:hover{{background:rgba(255,107,157,0.15)}}"
    )
    _test_worker_ref = []   # keep reference to prevent GC crash
    def _test_el():
        from audio.audio import TTSWorker, play_audio, stop_audio as sa
        sa()
        sample = f"Hey! I am feeling {emo_box.currentText()} right now~"
        eng = engine_box.itemData(engine_box.currentIndex())
        voice = voice_box.itemData(voice_box.currentIndex())
        mp = get_voice_path(win.sd)
        w = TTSWorker(sample, engine=eng, voice=voice,
                      model_path=mp, emotion=emo_box.currentText())
        w.done.connect(play_audio)
        w.done.connect(lambda _: w.wait(1000))   # keep alive until done
        w.failed.connect(lambda e: voice_result.setText(f"Test failed: {e}"))
        _test_worker_ref.clear()
        _test_worker_ref.append(w)   # prevent GC
        w.start()
    test_btn.clicked.connect(_test_el)
    test_row.addWidget(QLabel("Test emotion:")); test_row.addWidget(emo_box)
    test_row.addWidget(test_btn); test_row.addStretch()
    test_w = QWidget(); test_w.setLayout(test_row)
    fel.addRow(test_w)

    tabs.addTab(tp_el, "🎙️  ElevenLabs")

    # ── Tab: Piper (offline) ───────────────────────────────────────────────
    tp_pip = QWidget(); fp = QFormLayout(tp_pip)
    fp.setSpacing(12); fp.setContentsMargins(16, 16, 16, 8)

    # PIPER_MODELS and scan_piper_models already imported at module level
    piper_box = QComboBox()
    piper_box.addItem("(none found)" if not PIPER_MODELS else "", userData="")
    cur_piper = win.sd.get("selected_offline_voice", "")
    for name in sorted(PIPER_MODELS):
        piper_box.addItem(name, userData=name)
        if name == cur_piper:
            piper_box.setCurrentText(name)

    piper_hint = QLabel(
        "Place .onnx + .onnx.json files in tts/voices/\n"
        "Download from: github.com/rhasspy/piper/blob/master/VOICES.md"
    )
    piper_hint.setStyleSheet(f"color:{TXT2};font-size:10px")
    piper_hint.setWordWrap(True)

    rescan_btn = QPushButton("🔄  Rescan Voices")
    rescan_btn.setStyleSheet(
        f"QPushButton{{background:{BG3};border:1px solid {PURPLE};border-radius:8px;"
        f"padding:7px;color:{TXT1}}}QPushButton:hover{{background:rgba(192,132,252,0.15)}}"
    )
    def _rescan():
        scan_piper_models()
        piper_box.clear()
        for name in sorted(PIPER_MODELS):
            piper_box.addItem(name, userData=name)
        piper_hint.setText(f"Found {len(PIPER_MODELS)} voice(s)")
    rescan_btn.clicked.connect(_rescan)

    win._field_row(fp, "Voice Model", piper_box, "Select which .onnx voice to use")
    fp.addRow(piper_hint)
    fp.addRow(rescan_btn)
    tabs.addTab(tp_pip, "💾  Piper")

    # ── Tab: STT (Speech to Text) ─────────────────────────────────────────
    tp_stt = QWidget(); fstt = QFormLayout(tp_stt)
    fstt.setSpacing(10); fstt.setContentsMargins(16, 12, 16, 8)

    stt = CONFIG.get("stt", {})

    # Status
    if _STT_AVAILABLE:
        stt_status = QLabel("✅ sounddevice ready")
        stt_status.setStyleSheet("color:#4caf50;font-size:11px;font-weight:bold")
    else:
        stt_status = QLabel("⚠️ Run: pip install sounddevice scipy")
        stt_status.setStyleSheet("color:#ff9800;font-size:11px")
    fstt.addRow(stt_status)

    # Engine
    stt_eng_box = QComboBox()
    stt_eng_box.addItem("🌐  Groq Whisper  (online, free)", userData="groq")
    stt_eng_box.addItem("💾  Local Whisper  (offline, faster-whisper)", userData="local")
    cur_stt = stt.get("engine", "groq")
    for i in range(stt_eng_box.count()):
        if stt_eng_box.itemData(i) == cur_stt:
            stt_eng_box.setCurrentIndex(i); break
    win._field_row(fstt, "Engine", stt_eng_box)

    groq_model_box = QComboBox()
    for m in ["whisper-large-v3-turbo","whisper-large-v3","distil-whisper-large-v3-en"]:
        groq_model_box.addItem(m)
    idx = groq_model_box.findText(stt.get("groq_model","whisper-large-v3-turbo"))
    groq_model_box.setCurrentIndex(idx if idx >= 0 else 0)
    win._field_row(fstt, "Groq Model", groq_model_box)

    local_model_box = QComboBox()
    for m, desc in [("tiny","tiny"),("base","base (recommended)"),
                    ("small","small"),("medium","medium"),("large","large")]:
        local_model_box.addItem(desc, userData=m)
    cur_lm = stt.get("local_model","base")
    for i in range(local_model_box.count()):
        if local_model_box.itemData(i) == cur_lm:
            local_model_box.setCurrentIndex(i); break
    win._field_row(fstt, "Local Model", local_model_box)

    def _on_stt_eng(idx):
        v = stt_eng_box.itemData(idx)
        groq_model_box.setVisible(v == "groq")
        local_model_box.setVisible(v == "local")
        gl = fstt.labelForField(groq_model_box)
        ll = fstt.labelForField(local_model_box)
        if gl: gl.setVisible(v == "groq")
        if ll: ll.setVisible(v == "local")
    stt_eng_box.currentIndexChanged.connect(_on_stt_eng)
    _on_stt_eng(stt_eng_box.currentIndex())

    # ── Microphone picker ────────────────────────────────────────────
    mic_box = QComboBox()
    mic_box.addItem("🎤 Default Microphone", userData=-1)
    try:
        import sounddevice as sd
        devices = sd.query_devices()
        for i, d in enumerate(devices):
            if d["max_input_channels"] > 0:
                mic_box.addItem(f"  {d['name']}", userData=i)
        # Select saved device
        saved_dev = stt.get("device_index", -1)
        for i in range(mic_box.count()):
            if mic_box.itemData(i) == saved_dev:
                mic_box.setCurrentIndex(i); break
    except Exception:
        mic_box.addItem("(sounddevice not installed)", userData=-1)
    win._field_row(fstt, "Microphone", mic_box, "Select which mic to use for STT")

    # ── Mic sensitivity slider ────────────────────────────────────────
    # Range: 1× (raw) to 20× (very hot) — stored as float in config
    cur_gain = float(stt.get("mic_gain", 4.0))

    gain_row = QHBoxLayout()
    gain_slider = QSlider(Qt.Orientation.Horizontal)
    gain_slider.setRange(10, 200)          # 1.0× – 20.0× in 0.1 steps
    gain_slider.setValue(int(cur_gain * 10))
    gain_slider.setTickInterval(10)
    gain_slider.setTickPosition(QSlider.TickPosition.TicksBelow)

    def _gain_label(v: int) -> str:
        x = v / 10.0
        if x < 2:   feel = "subtle"
        elif x < 5: feel = "normal"
        elif x < 9: feel = "hot"
        elif x < 14:feel = "very hot"
        else:       feel = "🔥 extreme"
        return f"{x:.1f}×  ({feel})"

    gain_lbl = QLabel(_gain_label(gain_slider.value()))
    gain_lbl.setStyleSheet(f"color:{PINK};font-size:12px;font-weight:bold;min-width:130px")
    gain_lbl.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)

    def _on_gain(v: int):
        gain_lbl.setText(_gain_label(v))
        # Apply immediately so the live VU meter reflects it while testing
        CONFIG.setdefault("stt", {})["mic_gain"] = v / 10.0

    gain_slider.valueChanged.connect(_on_gain)
    gain_row.addWidget(gain_slider, 1)
    gain_row.addSpacing(10)
    gain_row.addWidget(gain_lbl)
    gain_w = QWidget(); gain_w.setLayout(gain_row)
    win._field_row(fstt, "🎚️ Mic Gain", gain_w,
                    "Amplify mic input before sending to Whisper. Boost if transcription misses quiet speech.")

    # ── Test recording ────────────────────────────────────────────────
    # ── Level bar + status ─────────────────────────────────────────────
    rec_indicator = QLabel("⚪  Not recording")
    rec_indicator.setStyleSheet("color:#888;font-size:11px;font-weight:bold")
    fstt.addRow(rec_indicator)

    # VU meter — row of 20 colored segments like a real level meter
    vu_container = QWidget()
    vu_layout = QHBoxLayout(vu_container)
    vu_layout.setContentsMargins(0,0,0,0); vu_layout.setSpacing(2)
    VU_SEGS = 20
    vu_segs = []
    for i in range(VU_SEGS):
        seg = QFrame(); seg.setFixedSize(14, 20)
        # Color: green for low, yellow for mid, red for peak
        if i < 12:   col_off, col_on = "#1a2a1a", "#4ade80"
        elif i < 16: col_off, col_on = "#2a2a0a", "#fbbf24"
        else:        col_off, col_on = "#2a0a0a", "#ff4444"
        seg.setStyleSheet(f"QFrame{{background:{col_off};border-radius:2px}}")
        seg._col_off = col_off; seg._col_on = col_on
        vu_layout.addWidget(seg)
        vu_segs.append(seg)
    vu_container.setVisible(False)
    fstt.addRow(QLabel("Level:"), vu_container)

    _vu_level = [0.0]   # smoothed level 0.0–1.0

    def _update_vu(raw_peak: float):
        import math
        from audio.stt import get_mic_gain
        # Apply gain so the meter reflects actual sensitivity setting
        gained = min(1.0, raw_peak * get_mic_gain())
        # Log scaling: quiet sounds fill many bars, loud fills all
        # log2(1 + gained*15) / log2(16) maps 0→0, 0.07→0.5, 1.0→1.0
        if gained > 0:
            scaled = math.log2(1.0 + gained * 15.0) / math.log2(16.0)
        else:
            scaled = 0.0
        # Fast attack, slow decay
        _vu_level[0] = max(scaled, _vu_level[0] * 0.72)
        lit = int(_vu_level[0] * VU_SEGS)
        for i, seg in enumerate(vu_segs):
            seg.setStyleSheet(
                f"QFrame{{background:{seg._col_on if i < lit else seg._col_off};"
                f"border-radius:2px}}"
            )

    playback_bar = QProgressBar()
    playback_bar.setRange(0, 100); playback_bar.setValue(0)
    playback_bar.setFixedHeight(8); playback_bar.setTextVisible(False)
    playback_bar.setStyleSheet(
        "QProgressBar{background:#1a1025;border:none;border-radius:4px}"
        "QProgressBar::chunk{background:qlineargradient(x1:0,y1:0,x2:1,y2:0,"
        "stop:0 #67e8f9,stop:1 #c084fc);border-radius:4px}"
    )
    playback_bar.setVisible(False)
    fstt.addRow(playback_bar)

    test_row2 = QHBoxLayout()
    rec_btn  = QPushButton("⏺  Start Test Recording")
    stop_btn = QPushButton("⏹  Stop & Play Back")
    stop_btn.setEnabled(False)
    rec_btn.setStyleSheet(
        "QPushButton{background:#c0392b;border:none;border-radius:8px;"
        "padding:7px 12px;color:white;font-size:11px;font-weight:bold}"
        "QPushButton:hover{background:#e74c3c}"
        "QPushButton:disabled{background:#3a2a3a;color:#666}"
    )
    stop_btn.setStyleSheet(
        "QPushButton{background:#2c3e50;border:1px solid #555;border-radius:8px;"
        "padding:7px 12px;color:#aaa;font-size:11px}"
        "QPushButton:enabled{background:#27ae60;border:none;color:white;font-weight:bold}"
        "QPushButton:enabled:hover{background:#2ecc71}"
    )
    test_row2.addWidget(rec_btn); test_row2.addWidget(stop_btn)
    test_w2 = QWidget(); test_w2.setLayout(test_row2)
    fstt.addRow(test_w2)

    _test_audio_data = []
    _level_timer     = [None]
    _playback_timer  = [None]
    test_rec_ref     = []
    _captured_rate   = [44100]   # saved here — test_rec_ref is cleared before playback

    def _start_test_rec():
        try:
            import sounddevice as sd, numpy as np
            dev_idx = mic_box.currentData()
            if dev_idx == -1: dev_idx = None
            rec_indicator.setText("🔴  Recording...  speak now!")
            rec_indicator.setStyleSheet("color:#ff4444;font-size:11px;font-weight:bold")
            rec_btn.setEnabled(False); stop_btn.setEnabled(True)
            vu_container.setVisible(True)
            playback_bar.setValue(0); playback_bar.setVisible(False)
            _test_audio_data.clear()

            _latest_peak = [0.0]

            # Query device native rate to avoid PaErrorCode -9997
            try:
                dev_info = sd.query_devices(dev_idx)
                _captured_rate[0] = int(dev_info.get("default_samplerate", 44100))
            except Exception:
                _captured_rate[0] = 44100

            def _cb(indata, frames, time_info, status):
                # Apply the same gain as the real STT path so VU reflects true sensitivity
                import numpy as _np
                from audio.stt import get_mic_gain
                gain = get_mic_gain()
                boosted = _np.clip(indata.astype(_np.float32) * gain, -32768, 32767).astype(_np.int16)
                _test_audio_data.append(boosted)
                # Raw peak before gain for VU (we'll scale in the tick)
                _latest_peak[0] = float(_np.abs(indata).max()) / 32768.0

            stream = sd.InputStream(
                samplerate=_captured_rate[0], channels=1,
                dtype="int16", callback=_cb,
                device=dev_idx,
            )
            stream.start()
            test_rec_ref.clear()
            test_rec_ref.append(stream)

            # Update VU meter in main thread via QTimer
            vu_container.setVisible(True)
            _t = QTimer(); _t.setInterval(40)   # 25fps
            def _vu_tick():
                _update_vu(_latest_peak[0])
                _latest_peak[0] = 0.0
            _t.timeout.connect(_vu_tick); _t.start()
            _level_timer[0] = _t

        except Exception as e:
            rec_indicator.setText(f"Error: {e}")
            rec_indicator.setStyleSheet("color:#ff9800;font-size:11px")

    def _stop_test_rec():
        if _level_timer[0]: _level_timer[0].stop(); _level_timer[0] = None
        if test_rec_ref:
            test_rec_ref[0].stop(); test_rec_ref[0].close(); test_rec_ref.clear()
        vu_container.setVisible(False)
        for seg in vu_segs:
            seg.setStyleSheet(f"QFrame{{background:{seg._col_off};border-radius:2px}}")
        rec_btn.setEnabled(True); stop_btn.setEnabled(False)

        if not _test_audio_data:
            rec_indicator.setText("⚪  No audio captured")
            rec_indicator.setStyleSheet("color:#888;font-size:11px;font-weight:bold")
            return

        try:
            import sounddevice as sd, numpy as np
            audio = np.concatenate(_test_audio_data, axis=0).flatten()
            # _captured_rate is set during recording and never cleared — always correct
            play_rate = _captured_rate[0]

            total_frames = len(audio)
            playback_bar.setValue(0); playback_bar.setVisible(True)
            rec_indicator.setText(f"▶  Playing back  ({play_rate} Hz)...")
            rec_indicator.setStyleSheet("color:#67e8f9;font-size:11px;font-weight:bold")

            sd.play(audio, samplerate=play_rate)
            duration_ms = int(total_frames / max(play_rate, 1) * 1000)

            import time as _time
            _start_ms = [_time.time()]
            _pt = QTimer(); _pt.setInterval(50)

            def _prog():
                elapsed = (_time.time() - _start_ms[0]) * 1000
                pct = int(min(100, elapsed / max(duration_ms, 1) * 100))
                playback_bar.setValue(pct)
                if pct >= 100:
                    _pt.stop()
                    QTimer.singleShot(300, lambda: playback_bar.setVisible(False))
                    rec_indicator.setText("✅  Playback done — sounds good?")
                    rec_indicator.setStyleSheet("color:#4caf50;font-size:11px;font-weight:bold")

            _pt.timeout.connect(_prog); _pt.start()
            _playback_timer[0] = _pt

        except Exception as e:
            rec_indicator.setText(f"Playback error: {e}")
            rec_indicator.setStyleSheet("color:#ff9800;font-size:11px")

    rec_btn.clicked.connect(_start_test_rec)
    stop_btn.clicked.connect(_stop_test_rec)

    install_hint = QLabel("Local: pip install faster-whisper")
    install_hint.setStyleSheet(f"color:{TXT2};font-size:10px;font-style:italic")
    fstt.addRow(install_hint)
    tabs.addTab(tp_stt, "🎤  STT")

    lay.addSpacing(8)

    def _save():

        # General
        win.sd["tts_enabled"]    = chk_enabled.isChecked()
        win.sd["lip_sync_tts"]   = chk_lipsync_tts.isChecked()
        win.sd["lip_sync_text"]  = chk_lipsync_txt.isChecked()
        win.sd["tts_engine"]  = engine_box.itemData(engine_box.currentIndex())
        CONFIG.setdefault("tts", {})["online_voice"] = voice_box.itemData(voice_box.currentIndex())

        # ElevenLabs
        CONFIG["elevenlabs"] = {
            "api_key":  e_key.text().strip(),
            "voice_id": e_vid.text().strip(),
            "model_id": el_model.currentText(),
        }

        # Piper
        sel = piper_box.currentData()
        if sel:
            win.sd["selected_offline_voice"] = sel

        # STT
        CONFIG["stt"] = {
            "engine":       stt_eng_box.itemData(stt_eng_box.currentIndex()),
            "groq_model":   groq_model_box.currentText(),
            "local_model":  local_model_box.currentData(),
            "device_index": mic_box.currentData(),
            "mic_gain":     gain_slider.value() / 10.0,
        }

        persist_save(win.sd)
        save_config()
        dlg.accept()

        eng_name = {"elevenlabs": "ElevenLabs 🎙️",
                    "online":     "edge-tts 🌐",
                    "offline":    "Piper 💾"}.get(win.sd["tts_engine"], win.sd["tts_engine"])
        state = "ON" if win.sd["tts_enabled"] else "OFF"
        win._display(f"TTS {state} — engine: {eng_name} [EMOTION: happy] 🔊")

    win._save_btn(dlg, lay, _save)
    dlg.show()
