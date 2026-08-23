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
from core.save import persist_save, save_traits, load_traits
from core.memory import dedup_traits
from audio.audio import PIPER_MODELS, scan_piper_models, get_voice_path
from pathlib import Path

def show_all_settings(win):
    """Unified settings: General / Memory / AI+API / TTS / STT.
    Theme selection lives ONLY in the right-click context menu."""
    t  = TH._active
    dlg = win._dlg_base("⚙️  Settings", w=560)
    outer = QVBoxLayout(dlg._content)
    outer.setContentsMargins(0, 0, 0, 8); outer.setSpacing(0)

    # ── QComboBox drop-down view fix: force dark theme on popup lists ─────
    COMBO_POPUP_SS = (
        f"QComboBox{{background:{t['BG3']};border:1px solid {t['BORDER']};"
        f"border-radius:8px;padding:5px 10px;color:{t['TXT1']};font-size:12px}}"
        f"QComboBox:hover{{border-color:{t['ACC2']}}}"
        f"QComboBox::drop-down{{border:none;width:20px}}"
        f"QComboBox QAbstractItemView{{background:{t['BG2']};border:1px solid {t['BORDER']};"
        f"border-radius:8px;color:{t['TXT1']};selection-background-color:{t['GLOW']};"
        f"selection-color:{t['ACC1']};padding:4px;outline:0}}"
        f"QComboBox QAbstractItemView::item{{padding:6px 12px;min-height:24px;border-radius:4px}}"
        f"QComboBox QAbstractItemView::item:hover{{background:{t['BG4']};color:{t['ACC1']}}}"
    )
    BTN_SS = (
        f"QPushButton{{background:{t['BG3']};border:1px solid {t['BORDER']};"
        f"border-radius:8px;padding:6px 14px;color:{t['TXT1']};font-size:12px}}"
        f"QPushButton:hover{{background:{t['BG4']};border-color:{t['ACC1']};color:{t['ACC1']}}}"
    )
    BTN_PRI = (
        f"QPushButton{{background:{t['BTN_GRAD']};border:none;"
        f"border-radius:8px;padding:7px 18px;color:white;font-size:12px;font-weight:bold}}"
        f"QPushButton:hover{{opacity:0.85}}"
    )
    INP_SS = (
        f"QLineEdit{{background:{t['BG3']};border:1px solid {t['BORDER']};"
        f"border-radius:8px;padding:6px 10px;color:{t['TXT1']};font-size:12px}}"
        f"QLineEdit:focus{{border-color:{t['ACC1']}}}"
    )
    CHKSS = (
        f"QCheckBox{{color:{t['TXT1']};font-size:12px;spacing:8px}}"
        f"QCheckBox::indicator{{width:16px;height:16px;border:1px solid {t['BORDER']};"
        f"border-radius:4px;background:{t['BG3']}}}"
        f"QCheckBox::indicator:checked{{background:{t['ACC2']};border-color:{t['ACC2']}}}"
    )
    SPIN_SS = (
        f"QSpinBox{{background:{t['BG3']};border:1px solid {t['BORDER']};"
        f"border-radius:8px;padding:4px 8px;color:{t['TXT1']};font-size:12px}}"
    )
    TEXTEDIT_SS = (
        f"QTextEdit{{background:{t['BG3']};border:1px solid {t['BORDER']};"
        f"border-radius:8px;color:{t['TXT1']};font-size:11px;padding:6px}}"
    )
    LIST_SS = (
        f"QListWidget{{background:{t['BG3']};border:1px solid {t['BORDER']};"
        f"border-radius:8px;color:{t['TXT1']};font-size:11px;padding:4px}}"
        f"QListWidget::item{{padding:3px 6px;border-radius:4px}}"
        f"QListWidget::item:selected{{background:{t['GLOW']};color:{t['ACC1']}}}"
    )

    tabs = QTabWidget()
    tabs.setStyleSheet(
        f"QTabWidget::pane{{background:{t['BG2']};border:1px solid {t['BORDER']};"
        f"border-bottom-left-radius:10px;border-bottom-right-radius:10px}}"
        f"QTabBar::tab{{background:{t['BG3']};color:{t['TXT2']};padding:8px 14px;"
        f"border-radius:6px 6px 0 0;font-size:11px;outline:0;margin-right:2px}}"
        f"QTabBar::tab:selected{{background:{t['ACC2']};color:white;font-weight:bold}}"
        f"QTabBar::tab:hover{{background:{t['BG4']};color:{t['ACC1']}}}"
    )
    outer.addWidget(tabs, 1)

    def _scr(w):
        """Wrap in a scroll area. Scrollbar is hidden (AlwaysOff) so it
        reserves ZERO pixels — nothing can clip right-edge content.
        Mouse wheel / keyboard still scrolls normally."""
        from PyQt6.QtWidgets import QScrollArea
        sc = QScrollArea(); sc.setWidgetResizable(True)
        sc.setFrameShape(QFrame.Shape.NoFrame)
        sc.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        sc.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        sc.setStyleSheet("QScrollArea{background:transparent;border:none}")
        w.setStyleSheet("background:transparent")
        sc.setWidget(w); return sc

    def _sec(lay, txt):
        sep = QFrame(); sep.setFixedHeight(1)
        sep.setStyleSheet(f"background:{t['BORDER']};margin:6px 0 2px 0")
        lay.addWidget(sep)
        lbl = QLabel(txt)
        lbl.setStyleSheet(f"color:{t['ACC2']};font-weight:bold;font-size:12px;padding-bottom:2px")
        lay.addWidget(lbl)

    def _row(label_txt, widget, tip=""):
        rw = QWidget(); rl = QHBoxLayout(rw)
        rl.setContentsMargins(0, 2, 0, 2); rl.setSpacing(10)
        lbl = QLabel(label_txt)
        lbl.setStyleSheet(f"color:{t['TXT2']};font-size:11px;min-width:105px")
        lbl.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        rl.addWidget(lbl); rl.addWidget(widget, 1)
        if tip:
            lbl.setToolTip(tip); widget.setToolTip(tip)
        return rw

    # ═════════════════════════════════════════════════════════════════════
    # TAB 1 ── General
    # ═════════════════════════════════════════════════════════════════════
    gen_w = QWidget(); gen_lay = QVBoxLayout(gen_w)
    gen_lay.setContentsMargins(16, 14, 16, 14); gen_lay.setSpacing(4)

    _sec(gen_lay, "💕  Identity")
    # User name
    user_inp = QLineEdit(win.sd.get("user_name", "User"))
    user_inp.setStyleSheet(INP_SS)
    gen_lay.addWidget(_row("Your Name:", user_inp))

    # Pet name
    pet_inp = QLineEdit(win.sd.get("pet_name", "Companion"))
    pet_inp.setStyleSheet(INP_SS)
    gen_lay.addWidget(_row("Companion Name:", pet_inp))

    _sec(gen_lay, "🧠  Brain Mode")
    _gen_bm = [win.sd.get("brain_mode", "local")]   # mutable so closures can write it
    bm_row_h = QHBoxLayout(); bm_row_h.setSpacing(6)
    bm_btns_gen: dict = {}
    for _bv, _bl in [("local","🖥 Local"),("online","🌐 Online"),("offline","💾 Offline")]:
        _btn = QPushButton(_bl); _btn.setCheckable(True)
        _btn.setChecked(_bv == _gen_bm[0]); _btn.setFixedHeight(28)
        _btn.setStyleSheet(
            f"QPushButton{{background:{t['BG3']};border:1px solid {t['BORDER']};"
            f"border-radius:8px;padding:0 10px;font-size:11px;color:{t['TXT2']}}}"
            f"QPushButton:checked{{background:{t['ACC2']};border-color:{t['ACC2']};"
            f"color:white;font-weight:bold}}"
            f"QPushButton:hover{{border-color:{t['ACC1']};color:{t['ACC1']}}}"
        )
        bm_btns_gen[_bv] = _btn; bm_row_h.addWidget(_btn)
    bm_row_h.addStretch()
    def _on_bm_gen(v):
        _gen_bm[0] = v
        for k, b in bm_btns_gen.items(): b.setChecked(k == v)
    for _bv, _btn in bm_btns_gen.items():
        _btn.clicked.connect(lambda _, v=_bv: _on_bm_gen(v))
    bm_row_w = QWidget(); bm_row_w.setLayout(bm_row_h)
    gen_lay.addWidget(bm_row_w)
    bm_hint = QLabel("🖥 Local = LM Studio/Ollama   🌐 Online = cloud API   💾 Offline = rule-based")
    bm_hint.setStyleSheet(f"color:{t['TXT2']};font-size:10px;padding-left:2px")
    gen_lay.addWidget(bm_hint)

    _sec(gen_lay, "💬  Conversation")
    chk_hearts = QCheckBox("Show affection hearts in top bar")
    chk_hearts.setChecked(win.sd.get("hearts_visible", True))
    chk_hearts.setStyleSheet(CHKSS)
    gen_lay.addWidget(chk_hearts)

    hist_spin = QSpinBox(); hist_spin.setRange(5, 200)
    hist_spin.setValue(CONFIG.get("max_history", 20))
    hist_spin.setStyleSheet(SPIN_SS)
    gen_lay.addWidget(_row("Message history limit:", hist_spin,
                           "How many messages to keep in context. Higher = better memory but more tokens."))

    _sec(gen_lay, "🔄  Maintenance")
    btn_setup = QPushButton("🔄  Redo Setup Wizard")
    btn_setup.setFixedHeight(32); btn_setup.setStyleSheet(BTN_SS)
    def _redo():
        win.sd["setup_complete"] = False; persist_save(win.sd)
        win.stack.setCurrentIndex(0); dlg.accept()
    btn_setup.clicked.connect(_redo)
    gen_lay.addWidget(btn_setup)

    btn_reset = QPushButton("⚠️  Factory Reset")
    btn_reset.setFixedHeight(32)
    btn_reset.setStyleSheet(
        "QPushButton{background:#7f1d1d;border:none;border-radius:8px;"
        "color:#fca5a5;font-size:12px}"
        "QPushButton:hover{background:#991b1b}"
    )
    def _reset():
        from core.save import DEFAULT_SAVE
        r = QMessageBox.question(win, "Factory Reset", "Wipes ALL saved data. Continue?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        if r == QMessageBox.StandardButton.Yes:
            win.sd.clear(); win.sd.update(DEFAULT_SAVE)
            win.hist.clear(); win.traits.clear()
            save_traits(win.traits); persist_save(win.sd)
            win._display("*reboots* I feel... new. [EMOTION: confused] 🔄")
            dlg.accept()
    btn_reset.clicked.connect(_reset)
    gen_lay.addWidget(btn_reset)
    gen_lay.addStretch()

    def _save_gen():
        win.sd["user_name"] = user_inp.text().strip() or "User"
        win.sd["pet_name"]  = pet_inp.text().strip()  or "Companion"
        # Brain mode — update topbar icon immediately
        win.sd["brain_mode"] = _gen_bm[0]
        win._upd_brain()
        win.hvis = chk_hearts.isChecked()
        win.sd["hearts_visible"] = win.hvis; win._upd_hearts()
        CONFIG["max_history"] = hist_spin.value()
        # Update top-bar name immediately
        if hasattr(win, "name_lbl"):
            win.name_lbl.setText(win.sd["pet_name"].upper())
        persist_save(win.sd)

    tabs.addTab(gen_w, "⚙️ General")

    # ═════════════════════════════════════════════════════════════════════
    # TAB 2 ── Memory
    # ═════════════════════════════════════════════════════════════════════
    mem_w = QWidget(); mem_lay = QVBoxLayout(mem_w)
    mem_lay.setContentsMargins(16, 14, 16, 14); mem_lay.setSpacing(6)

    _sec(mem_lay, "🧠  Long-Term Traits")
    mem_info = QLabel(f"Traits: {len(win.traits)}  |  History: {len(win.hist)} messages")
    mem_info.setStyleSheet(f"color:{t['TXT2']};font-size:11px")
    mem_lay.addWidget(mem_info)

    traits_view = QTextEdit()
    traits_view.setReadOnly(True); traits_view.setFixedHeight(100)
    traits_view.setStyleSheet(TEXTEDIT_SS)
    traits_view.setPlainText("\n".join(win.traits[:60]) if win.traits else "(no traits stored yet)")
    mem_lay.addWidget(traits_view)

    btn_wipe = QPushButton("🗑️  Wipe Traits & History")
    btn_wipe.setFixedHeight(30)
    btn_wipe.setStyleSheet(
        f"QPushButton{{background:{t['BG3']};border:1px solid {t['BORDER']};"
        f"border-radius:8px;color:{t['TXT1']};font-size:12px}}"
        f"QPushButton:hover{{background:#7f1d1d;color:#fca5a5}}"
    )
    def _wipe():
        win.hist.clear(); win.traits.clear()
        save_traits(win.traits); win._upd_mem()
        traits_view.setPlainText("(cleared)")
        hist_view.setPlainText("(cleared)")
        mem_info.setText("Traits: 0  |  History: 0 messages")
    btn_wipe.clicked.connect(_wipe)
    mem_lay.addWidget(btn_wipe)

    _sec(mem_lay, "💬  Chat History")
    hist_view = QTextEdit()
    hist_view.setReadOnly(True)
    hist_view.setStyleSheet(TEXTEDIT_SS)
    hist_view.setMinimumHeight(150)
    # Render conversation history in readable form
    if win.hist:
        lines = []
        for msg in win.hist:
            role = "You" if msg["role"] == "user" else win.sd.get("pet_name", "Companion")
            lines.append(f"[{role}]  {msg['content'][:300]}")
        hist_view.setPlainText("\n\n".join(lines))
    else:
        hist_view.setPlainText("(no chat history yet)")
    mem_lay.addWidget(hist_view, 1)

    _sec(mem_lay, "💬  Message Limit")
    msg_spin = QSpinBox(); msg_spin.setRange(5, 200)
    msg_spin.setValue(CONFIG.get("max_history", 20))
    msg_spin.setStyleSheet(SPIN_SS)
    msg_spin.setToolTip("Higher = better memory, but uses more tokens per request.")
    mem_lay.addWidget(_row("Keep last N messages:", msg_spin))

    def _save_mem():
        CONFIG["max_history"] = msg_spin.value()

    tabs.addTab(mem_w, "🧠 Memory")

    # ═════════════════════════════════════════════════════════════════════
    # TAB 3 ── AI / API
    # ═════════════════════════════════════════════════════════════════════
    ai_w = QWidget(); ai_lay = QVBoxLayout(ai_w)
    ai_lay.setContentsMargins(16, 14, 16, 14); ai_lay.setSpacing(4)

    _sec(ai_lay, "🌐  Online API  (Groq, OpenAI-compatible, etc.)")
    o_url  = QLineEdit(CONFIG.get("online_api_url", "")); o_url.setStyleSheet(INP_SS)
    o_key_w, o_key = win._eye_field("sk-...", CONFIG.get("online_api_key", ""))
    o_mdl  = QLineEdit(CONFIG.get("online_api_model", "")); o_mdl.setStyleSheet(INP_SS)
    ai_lay.addWidget(_row("URL:", o_url))
    ai_lay.addWidget(_row("API Key:", o_key_w))
    ai_lay.addWidget(_row("Model:", o_mdl))

    _sec(ai_lay, "🖥️  Local API  (LM Studio / Ollama)")
    l_url  = QLineEdit(CONFIG.get("local_api_url", "")); l_url.setStyleSheet(INP_SS)
    l_key_w, l_key = win._eye_field("(optional)", CONFIG.get("local_api_key", ""))
    l_mdl  = QLineEdit(CONFIG.get("local_api_model", "")); l_mdl.setStyleSheet(INP_SS)
    ai_lay.addWidget(_row("URL:", l_url))
    ai_lay.addWidget(_row("API Key:", l_key_w))
    ai_lay.addWidget(_row("Model:", l_mdl))

    _sec(ai_lay, "⛏️  Minecraft Brain API  (mc_brain.py)")
    mc_cfg = CONFIG.get("minecraft", {})
    mc_burl_inp = QLineEdit(mc_cfg.get("brain_url", "")); mc_burl_inp.setStyleSheet(INP_SS)
    mc_bkey_w, mc_bkey = win._eye_field("MC Brain API Key", mc_cfg.get("brain_key", ""))
    mc_bmdl_inp = QLineEdit(mc_cfg.get("brain_model", "")); mc_bmdl_inp.setStyleSheet(INP_SS)
    ai_lay.addWidget(_row("Brain URL:", mc_burl_inp))
    ai_lay.addWidget(_row("Brain Key:", mc_bkey_w))
    ai_lay.addWidget(_row("Brain Model:", mc_bmdl_inp))

    ai_lay.addSpacing(8)
    ai_save_btn = QPushButton("💾  Save AI / API Settings")
    ai_save_btn.setFixedHeight(34); ai_save_btn.setStyleSheet(BTN_PRI)
    def _save_ai():
        CONFIG["online_api_url"]   = o_url.text().strip()
        CONFIG["online_api_key"]   = o_key.text().strip()
        CONFIG["online_api_model"] = o_mdl.text().strip()
        CONFIG["local_api_url"]    = l_url.text().strip()
        CONFIG["local_api_key"]    = l_key.text().strip()
        CONFIG["local_api_model"]  = l_mdl.text().strip()
        CONFIG.setdefault("minecraft", {})["brain_url"]   = mc_burl_inp.text().strip()
        CONFIG["minecraft"]["brain_key"]   = mc_bkey.text().strip()
        CONFIG["minecraft"]["brain_model"] = mc_bmdl_inp.text().strip()
        save_config()
        win._display("*reconfiguring* API settings saved! [EMOTION: happy] 💾")
    ai_save_btn.clicked.connect(_save_ai)
    ai_lay.addWidget(ai_save_btn)
    ai_lay.addStretch()
    tabs.addTab(ai_w, "🌐 AI/API")

    # ═════════════════════════════════════════════════════════════════════
    # TAB 4 ── TTS
    # ═════════════════════════════════════════════════════════════════════
    tts_w = QWidget(); tts_lay = QVBoxLayout(tts_w)
    tts_lay.setContentsMargins(16, 14, 16, 14); tts_lay.setSpacing(4)

    _sec(tts_lay, "🔊  General")
    chk_tts_on = QCheckBox("Enable Text-to-Speech")
    chk_tts_on.setChecked(win.sd.get("tts_enabled", False))
    chk_tts_on.setStyleSheet(CHKSS)
    tts_lay.addWidget(chk_tts_on)

    chk_ls_tts = QCheckBox("🎙️  Lip-sync during TTS playback  (mouth opens/closes while speaking)")
    chk_ls_tts.setChecked(win.sd.get("lip_sync_tts", True))
    chk_ls_tts.setStyleSheet(CHKSS)
    tts_lay.addWidget(chk_ls_tts)

    chk_ls_txt = QCheckBox("💬  Lip-sync during text typing  (mouth moves per word, no audio needed)")
    chk_ls_txt.setChecked(win.sd.get("lip_sync_text", False))
    chk_ls_txt.setStyleSheet(CHKSS)
    tts_lay.addWidget(chk_ls_txt)

    try:
        from audio.tts_elevenlabs import is_configured as _el_ok
        _el_configured = _el_ok()
    except ImportError:
        _el_configured = False

    tts_eng_box = QComboBox()
    tts_eng_box.setStyleSheet(COMBO_POPUP_SS)
    for val, lbl in [
        ("elevenlabs", f"🎙️  ElevenLabs  {'✅' if _el_configured else '(not configured)'}"),
        ("online",     "🌐  edge-tts  (free, online)"),
        ("offline",    "💾  Piper  (offline, local)"),
    ]:
        tts_eng_box.addItem(lbl, userData=val)
    cur_eng = win.sd.get("tts_engine", "online")
    for i in range(tts_eng_box.count()):
        if tts_eng_box.itemData(i) == cur_eng: tts_eng_box.setCurrentIndex(i); break
    tts_lay.addWidget(_row("Engine:", tts_eng_box))

    # ── edge-tts voice ────────────────────────────────────────────────────
    _sec(tts_lay, "🌐  edge-tts")
    edge_box = QComboBox(); edge_box.setStyleSheet(COMBO_POPUP_SS)
    for v, l in [
        ("en-US-AriaNeural",    "Aria — US English, warm"),
        ("en-US-JennyNeural",   "Jenny — US English, friendly"),
        ("en-US-SaraNeural",    "Sara — US English, cheerful"),
        ("en-GB-SoniaNeural",   "Sonia — British English"),
        ("en-AU-NatashaNeural", "Natasha — Australian English"),
        ("ja-JP-NanamiNeural",  "Nanami — Japanese"),
        ("ko-KR-SunHiNeural",   "SunHi — Korean"),
    ]:
        edge_box.addItem(l, userData=v)
    cv = CONFIG.get("tts", {}).get("online_voice", "en-US-AriaNeural")
    for i in range(edge_box.count()):
        if edge_box.itemData(i) == cv: edge_box.setCurrentIndex(i); break
    edge_row_w = _row("Voice:", edge_box)
    tts_lay.addWidget(edge_row_w)

    # ── ElevenLabs ────────────────────────────────────────────────────────
    _sec(tts_lay, "🎙️  ElevenLabs")
    el = CONFIG.get("elevenlabs", {})
    el_key_wrap, el_key_edit = win._eye_field("Paste ElevenLabs API key…", el.get("api_key", ""))
    tts_lay.addWidget(_row("API Key:", el_key_wrap))

    # Voice ID + Model on same row
    el_vid_inp = QLineEdit(el.get("voice_id", ""))
    el_vid_inp.setPlaceholderText("e.g. 21m00Tcm4TlvDq8ikWAM")
    el_vid_inp.setStyleSheet(INP_SS)
    el_mdl_box = QComboBox(); el_mdl_box.setStyleSheet(COMBO_POPUP_SS)
    for m in ["eleven_flash_v2_5", "eleven_flash_v2",
              "eleven_turbo_v2_5", "eleven_turbo_v2", "eleven_multilingual_v2"]:
        el_mdl_box.addItem(m)
    cur_m = el.get("model_id", "eleven_flash_v2_5")
    idx = el_mdl_box.findText(cur_m)
    el_mdl_box.setCurrentIndex(idx if idx >= 0 else 0)

    vid_mdl_w = QWidget(); vid_mdl_l = QHBoxLayout(vid_mdl_w)
    vid_mdl_l.setContentsMargins(0, 0, 0, 0); vid_mdl_l.setSpacing(6)
    vid_mdl_l.addWidget(el_vid_inp, 2)
    vid_mdl_l.addWidget(QLabel("Model:"))
    vid_mdl_l.addWidget(el_mdl_box, 1)
    tts_lay.addWidget(_row("Voice ID:", vid_mdl_w,
                           "Voice ID from elevenlabs.io Voice Library"))

    el_voice_result = QLabel("")
    el_voice_result.setStyleSheet(f"color:{t['TXT2']};font-size:10px")
    el_voice_result.setWordWrap(True)
    tts_lay.addWidget(el_voice_result)

    el_btn_row = QHBoxLayout()
    el_fetch_btn = QPushButton("🔍  Fetch My Voices"); el_fetch_btn.setStyleSheet(BTN_SS)
    def _el_fetch():
        CONFIG.setdefault("elevenlabs", {})["api_key"] = el_key_edit.text().strip()
        try:
            from audio.tts_elevenlabs import list_voices
            vs = list_voices()
            if vs:
                el_voice_result.setText("\n".join(f"{v['name']}  →  {v['voice_id']}" for v in vs[:8]))
            else:
                el_voice_result.setText("No voices found — check your API key")
        except Exception as ex:
            el_voice_result.setText(f"Error: {ex}")
    el_fetch_btn.clicked.connect(_el_fetch)

    el_emo_box = QComboBox(); el_emo_box.setStyleSheet(COMBO_POPUP_SS)
    for e in ["excited", "sad", "angry", "love", "evil", "sleepy", "mocking", "blush", "shocked"]:
        el_emo_box.addItem(e)
    el_test_btn = QPushButton("▶  Test"); el_test_btn.setStyleSheet(BTN_SS)
    _el_test_ref = []
    # Guard: cleared when dialog closes so signals can't touch dead Qt objects
    _el_result_ref = [el_voice_result]
    def _el_test():
        from audio.audio import TTSWorker, play_audio, stop_audio as _sa
        _sa()
        eng = tts_eng_box.itemData(tts_eng_box.currentIndex())
        voice = edge_box.itemData(edge_box.currentIndex())
        mp = get_voice_path(win.sd)
        sample = f"Hey, I am feeling {el_emo_box.currentText()} right now~"
        w = TTSWorker(sample, engine=eng, voice=voice, model_path=mp,
                      emotion=el_emo_box.currentText())
        w.done.connect(play_audio)
        w.done.connect(lambda _: w.wait(1000))
        def _on_tts_fail(e):
            if _el_result_ref:   # dialog still alive
                _el_result_ref[0].setText(f"Test failed: {e}")
        w.failed.connect(_on_tts_fail)
        _el_test_ref.clear(); _el_test_ref.append(w); w.start()
    el_test_btn.clicked.connect(_el_test)
    # On dialog close: disarm result ref so in-flight workers can't crash
    dlg.finished.connect(lambda _: _el_result_ref.clear())
    el_btn_row.addWidget(el_fetch_btn); el_btn_row.addWidget(QLabel("Emo:"))
    el_btn_row.addWidget(el_emo_box); el_btn_row.addWidget(el_test_btn)
    el_btn_w = QWidget(); el_btn_w.setLayout(el_btn_row)
    tts_lay.addWidget(el_btn_w)

    # ── Piper ─────────────────────────────────────────────────────────────
    _sec(tts_lay, "💾  Piper  (offline)")
    piper_box = QComboBox(); piper_box.setStyleSheet(COMBO_POPUP_SS)
    cur_piper = win.sd.get("selected_offline_voice", "")
    if not PIPER_MODELS:
        piper_box.addItem("(no voices found — browse below)", userData="")
    for name in sorted(PIPER_MODELS):
        piper_box.addItem(name, userData=name)
        if name == cur_piper: piper_box.setCurrentText(name)
    tts_lay.addWidget(_row("Voice Model:", piper_box, "Select which .onnx voice to use"))

    # Browse button for piper voice file
    piper_path_inp = QLineEdit()
    piper_path_inp.setPlaceholderText("Or browse to a .onnx file…")
    piper_path_inp.setStyleSheet(INP_SS)
    piper_path_inp.setReadOnly(True)
    piper_browse_btn = QPushButton("📂  Browse")
    piper_browse_btn.setStyleSheet(BTN_SS)
    def _piper_browse():
        from PyQt6.QtWidgets import QFileDialog
        path, _ = QFileDialog.getOpenFileName(
            dlg, "Select Piper Voice (.onnx)", str(VOICES_DIR),
            "Piper Voice (*.onnx);;All files (*.*)"
        )
        if path:
            piper_path_inp.setText(path)
            # Auto-register stem as a custom entry
            stem = Path(path).stem
            if piper_box.findText(stem) < 0:
                piper_box.addItem(stem, userData=path)
                PIPER_MODELS[stem] = path
            piper_box.setCurrentText(stem)
    piper_browse_btn.clicked.connect(_piper_browse)
    pip_path_row = QHBoxLayout()
    pip_path_row.addWidget(piper_path_inp, 1); pip_path_row.addWidget(piper_browse_btn)
    pip_path_w = QWidget(); pip_path_w.setLayout(pip_path_row)
    tts_lay.addWidget(_row("Browse .onnx:", pip_path_w))

    piper_rescan_btn = QPushButton("🔄  Rescan tts/voices/ folder")
    piper_rescan_btn.setStyleSheet(BTN_SS)
    def _piper_rescan():
        scan_piper_models()
        piper_box.clear()
        for name in sorted(PIPER_MODELS):
            piper_box.addItem(name, userData=name)
        el_voice_result.setText(f"Found {len(PIPER_MODELS)} voice(s)")
    piper_rescan_btn.clicked.connect(_piper_rescan)
    piper_hint = QLabel(
        "Place .onnx + .onnx.json in tts/voices/  |  "
        "Download: github.com/rhasspy/piper/blob/master/VOICES.md"
    )
    piper_hint.setStyleSheet(f"color:{t['TXT2']};font-size:10px")
    piper_hint.setWordWrap(True)
    tts_lay.addWidget(piper_hint)
    tts_lay.addWidget(piper_rescan_btn)

    # Show/hide edge-tts section based on engine
    def _tts_eng_changed(idx):
        v = tts_eng_box.itemData(idx)
        edge_row_w.setVisible(v == "online")
    tts_eng_box.currentIndexChanged.connect(_tts_eng_changed)
    _tts_eng_changed(tts_eng_box.currentIndex())

    def _save_tts():
        win.sd["tts_enabled"]  = chk_tts_on.isChecked()
        win.sd["lip_sync_tts"] = chk_ls_tts.isChecked()
        win.sd["lip_sync_text"]= chk_ls_txt.isChecked()
        win.sd["tts_engine"]   = tts_eng_box.itemData(tts_eng_box.currentIndex())
        CONFIG.setdefault("tts", {})["online_voice"] = edge_box.itemData(edge_box.currentIndex())
        CONFIG["elevenlabs"] = {
            "api_key":  el_key_edit.text().strip(),
            "voice_id": el_vid_inp.text().strip(),
            "model_id": el_mdl_box.currentText(),
        }
        sel_piper = piper_box.currentData()
        if sel_piper:
            win.sd["selected_offline_voice"] = sel_piper
    tts_lay.addStretch()
    tabs.addTab(tts_w, "🔊 TTS")

    # ═════════════════════════════════════════════════════════════════════
    # TAB 5 ── STT  (full mic tester suite)
    # ═════════════════════════════════════════════════════════════════════
    stt_w = QWidget(); stt_lay = QVBoxLayout(stt_w)
    stt_lay.setContentsMargins(16, 14, 16, 14); stt_lay.setSpacing(4)
    stt_cfg = CONFIG.get("stt", {})

    _sec(stt_lay, "🎤  Engine & Model")
    try:
        import sounddevice
        _STT_AVAILABLE = True
    except ImportError:
        _STT_AVAILABLE = False
    if _STT_AVAILABLE:
        stt_status = QLabel("✅ sounddevice ready")
        stt_status.setStyleSheet("color:#4caf50;font-size:11px;font-weight:bold")
    else:
        stt_status = QLabel("⚠️  Run:  pip install sounddevice scipy")
        stt_status.setStyleSheet("color:#ff9800;font-size:11px")
    stt_lay.addWidget(stt_status)

    stt_eng_box = QComboBox(); stt_eng_box.setStyleSheet(COMBO_POPUP_SS)
    stt_eng_box.addItem("🌐  Groq Whisper  (online, fast)", userData="groq")
    stt_eng_box.addItem("💾  Local Whisper  (offline)", userData="local")
    cur_stt = stt_cfg.get("engine", "groq")
    for i in range(stt_eng_box.count()):
        if stt_eng_box.itemData(i) == cur_stt: stt_eng_box.setCurrentIndex(i); break
    stt_lay.addWidget(_row("Engine:", stt_eng_box))

    groq_mdl_box = QComboBox(); groq_mdl_box.setStyleSheet(COMBO_POPUP_SS)
    for m in ["whisper-large-v3-turbo", "whisper-large-v3", "distil-whisper-large-v3-en"]:
        groq_mdl_box.addItem(m)
    gidx = groq_mdl_box.findText(stt_cfg.get("groq_model", "whisper-large-v3-turbo"))
    groq_mdl_box.setCurrentIndex(gidx if gidx >= 0 else 0)
    groq_row_w = _row("Groq Model:", groq_mdl_box)
    stt_lay.addWidget(groq_row_w)

    local_mdl_box = QComboBox(); local_mdl_box.setStyleSheet(COMBO_POPUP_SS)
    for m, d in [("tiny","tiny"),("base","base (recommended)"),
                 ("small","small"),("medium","medium"),("large","large")]:
        local_mdl_box.addItem(d, userData=m)
    cur_lm = stt_cfg.get("local_model", "base")
    for i in range(local_mdl_box.count()):
        if local_mdl_box.itemData(i) == cur_lm: local_mdl_box.setCurrentIndex(i); break
    local_row_w = _row("Local Model:", local_mdl_box)
    stt_lay.addWidget(local_row_w)

    def _stt_eng_changed(idx):
        v = stt_eng_box.itemData(idx)
        groq_row_w.setVisible(v == "groq")
        local_row_w.setVisible(v == "local")
    stt_eng_box.currentIndexChanged.connect(_stt_eng_changed)
    _stt_eng_changed(stt_eng_box.currentIndex())

    _sec(stt_lay, "🎤  Microphone")
    mic_box = QComboBox(); mic_box.setStyleSheet(COMBO_POPUP_SS)
    mic_box.addItem("🎤 Default Microphone", userData=-1)
    try:
        import sounddevice as _sd_q
        for i, d in enumerate(_sd_q.query_devices()):
            if d["max_input_channels"] > 0:
                mic_box.addItem(f"  {d['name']}", userData=i)
        saved_dev = stt_cfg.get("device_index", -1)
        for i in range(mic_box.count()):
            if mic_box.itemData(i) == saved_dev: mic_box.setCurrentIndex(i); break
    except Exception:
        mic_box.addItem("(sounddevice not installed)", userData=-1)
    stt_lay.addWidget(_row("Microphone:", mic_box))

    _sec(stt_lay, "🎚️  Mic Gain")
    cur_gain = float(stt_cfg.get("mic_gain", 4.0))
    gain_row_l = QHBoxLayout()
    gain_slider = QSlider(Qt.Orientation.Horizontal)
    gain_slider.setRange(10, 200); gain_slider.setValue(int(cur_gain * 10))
    gain_slider.setTickInterval(10)
    gain_slider.setTickPosition(QSlider.TickPosition.TicksBelow)
    gain_slider.setStyleSheet(
        f"QSlider::groove:horizontal{{background:{t['BG3']};height:6px;border-radius:3px}}"
        f"QSlider::handle:horizontal{{background:{t['ACC1']};border:none;width:14px;"
        f"height:14px;border-radius:7px;margin:-4px 0}}"
        f"QSlider::sub-page:horizontal{{background:{t['ACC2']};border-radius:3px}}"
    )

    def _gain_txt(v):
        x = v / 10.0
        if x < 2:    feel = "subtle"
        elif x < 5:  feel = "normal"
        elif x < 9:  feel = "hot"
        elif x < 14: feel = "very hot"
        else:        feel = "🔥 extreme"
        return f"{x:.1f}×  ({feel})"

    gain_lbl = QLabel(_gain_txt(gain_slider.value()))
    gain_lbl.setStyleSheet(
        f"color:{t['ACC1']};font-size:12px;font-weight:bold;min-width:140px"
    )
    gain_lbl.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)

    def _on_gain(v):
        gain_lbl.setText(_gain_txt(v))
        CONFIG.setdefault("stt", {})["mic_gain"] = v / 10.0
    gain_slider.valueChanged.connect(_on_gain)
    gain_row_l.addWidget(gain_slider, 1); gain_row_l.addSpacing(8)
    gain_row_l.addWidget(gain_lbl)
    gain_row_w = QWidget(); gain_row_w.setLayout(gain_row_l)
    stt_lay.addWidget(gain_row_w)

    _sec(stt_lay, "🔬  Mic Test")
    rec_status = QLabel("⚪  Idle — press Start to test")
    rec_status.setStyleSheet("color:#888;font-size:11px;font-weight:bold")
    stt_lay.addWidget(rec_status)

    # VU meter: 20 segments
    vu_wrap = QWidget(); vu_l = QHBoxLayout(vu_wrap)
    vu_l.setContentsMargins(0, 2, 0, 2); vu_l.setSpacing(2)
    VU_N = 20; vu_segs = []
    for i in range(VU_N):
        seg = QFrame(); seg.setFixedSize(16, 22)
        if i < 12:   c_off, c_on = "#1a2a1a", "#4ade80"
        elif i < 16: c_off, c_on = "#2a2a0a", "#fbbf24"
        else:        c_off, c_on = "#2a0a0a", "#ff4444"
        seg.setStyleSheet(f"QFrame{{background:{c_off};border-radius:2px}}")
        seg._c_off = c_off; seg._c_on = c_on
        vu_l.addWidget(seg); vu_segs.append(seg)
    vu_l.addStretch()
    vu_lvl_lbl = QLabel("LEVEL")
    vu_lvl_lbl.setStyleSheet(f"color:{t['TXT2']};font-size:10px;font-weight:bold")
    vu_l.addWidget(vu_lvl_lbl)
    vu_wrap.setVisible(False)
    stt_lay.addWidget(vu_wrap)

    pb_playback = QProgressBar()
    pb_playback.setRange(0, 100); pb_playback.setValue(0)
    pb_playback.setFixedHeight(6); pb_playback.setTextVisible(False)
    pb_playback.setStyleSheet(
        f"QProgressBar{{background:{t['BG3']};border:none;border-radius:3px}}"
        f"QProgressBar::chunk{{background:{t['PROGRESS']};border-radius:3px}}"
    )
    pb_playback.setVisible(False)
    stt_lay.addWidget(pb_playback)

    rec_row = QHBoxLayout()
    rec_btn  = QPushButton("⏺  Start Test Recording")
    stop_btn = QPushButton("⏹  Stop && Play Back")
    stop_btn.setEnabled(False)
    rec_btn.setStyleSheet(
        "QPushButton{background:#c0392b;border:none;border-radius:8px;"
        "padding:7px 14px;color:white;font-size:11px;font-weight:bold}"
        "QPushButton:hover{background:#e74c3c}"
        "QPushButton:disabled{background:#3a2a3a;color:#555}"
    )
    stop_btn.setStyleSheet(
        "QPushButton{background:#2c3e50;border:1px solid #555;border-radius:8px;"
        "padding:7px 14px;color:#666;font-size:11px}"
        "QPushButton:enabled{background:#27ae60;border:none;color:white;font-weight:bold}"
        "QPushButton:enabled:hover{background:#2ecc71}"
        "QPushButton:disabled{background:#2c3e50;color:#555}"
    )
    rec_row.addWidget(rec_btn, 1); rec_row.addWidget(stop_btn, 1)
    rec_row_w = QWidget(); rec_row_w.setLayout(rec_row)
    stt_lay.addWidget(rec_row_w)

    install_note = QLabel(
        "Local whisper: pip install faster-whisper  |  "
        "Groq: add your API key in the AI/API tab"
    )
    install_note.setStyleSheet(f"color:{t['TXT2']};font-size:10px;font-style:italic")
    install_note.setWordWrap(True)
    stt_lay.addWidget(install_note)

    # ── Test recording logic ──────────────────────────────────────────────
    import math as _math
    _audio_buf  = []
    _vu_smooth  = [0.0]
    _cap_rate   = [44100]
    _stream_ref = []
    _peak_ref   = [0.0]
    _tmr_vu     = [None]
    _tmr_pb     = [None]
    _pb_alive   = [True]   # ← poison-pill: flipped False on dialog close

    def _set_vu(peak: float):
        gained = min(1.0, peak * (gain_slider.value() / 10.0))
        scaled = (_math.log2(1.0 + gained * 15.0) / _math.log2(16.0)) if gained > 0 else 0.0
        _vu_smooth[0] = max(scaled, _vu_smooth[0] * 0.72)
        lit = int(_vu_smooth[0] * VU_N)
        for i, seg in enumerate(vu_segs):
            seg.setStyleSheet(
                f"QFrame{{background:{seg._c_on if i < lit else seg._c_off};border-radius:2px}}"
            )

    def _start_rec():
        try:
            import sounddevice as _sd, numpy as _np
            dev = mic_box.currentData()
            if dev == -1: dev = None
            try:
                info = _sd.query_devices(dev)
                _cap_rate[0] = int(info.get("default_samplerate", 44100))
            except Exception:
                _cap_rate[0] = 44100

            rec_status.setText("🔴  Recording… speak now!")
            rec_status.setStyleSheet("color:#ff4444;font-size:11px;font-weight:bold")
            rec_btn.setEnabled(False); stop_btn.setEnabled(True)
            vu_wrap.setVisible(True); pb_playback.setVisible(False)
            _audio_buf.clear(); _peak_ref[0] = 0.0

            def _cb(indata, frames, t_info, status):
                import numpy as _np2
                _audio_buf.append(indata.copy())
                _peak_ref[0] = float(_np2.abs(indata).max()) / 32768.0

            s = _sd.InputStream(
                samplerate=_cap_rate[0], channels=1,
                dtype="int16", callback=_cb, device=dev
            )
            s.start(); _stream_ref.clear(); _stream_ref.append(s)

            t = QTimer(); t.setInterval(40)
            def _vu_tick():
                _set_vu(_peak_ref[0]); _peak_ref[0] = 0.0
            t.timeout.connect(_vu_tick); t.start()
            _tmr_vu[0] = t
        except Exception as ex:
            rec_status.setText(f"Error: {ex}")
            rec_status.setStyleSheet("color:#ff9800;font-size:11px")

    def _stop_rec():
        if _tmr_vu[0]: _tmr_vu[0].stop(); _tmr_vu[0] = None
        if _stream_ref:
            _stream_ref[0].stop(); _stream_ref[0].close(); _stream_ref.clear()
        vu_wrap.setVisible(False)
        for seg in vu_segs:
            seg.setStyleSheet(f"QFrame{{background:{seg._c_off};border-radius:2px}}")
        rec_btn.setEnabled(True); stop_btn.setEnabled(False)

        if not _audio_buf:
            rec_status.setText("⚪  No audio captured — try again")
            rec_status.setStyleSheet("color:#888;font-size:11px;font-weight:bold")
            return

        try:
            import sounddevice as _sd2, numpy as _np3
            audio = _np3.concatenate(_audio_buf, axis=0).flatten()
            rate  = _cap_rate[0]
            total_ms = int(len(audio) / max(rate, 1) * 1000)
            pb_playback.setValue(0); pb_playback.setVisible(True)
            rec_status.setText(f"▶  Playing back  ({rate} Hz, {total_ms // 1000}.{(total_ms % 1000) // 100}s)…")
            rec_status.setStyleSheet("color:#67e8f9;font-size:11px;font-weight:bold")
            _sd2.play(audio, samplerate=rate)
            import time as _t2; _t_start = [_t2.time()]
            pt = QTimer(); pt.setInterval(50)
            def _prog():
                if not _pb_alive[0]:          # dialog already closed — bail before touching dead widgets
                    pt.stop()
                    return
                pct = int(min(100, (_t2.time() - _t_start[0]) * 1000 / max(total_ms, 1) * 100))
                pb_playback.setValue(pct)
                if pct >= 100:
                    pt.stop()
                    QTimer.singleShot(400, lambda: pb_playback.setVisible(False) if _pb_alive[0] else None)
                    rec_status.setText("✅  Playback done — sounds good?")
                    rec_status.setStyleSheet("color:#4caf50;font-size:11px;font-weight:bold")
            pt.timeout.connect(_prog); pt.start()
            _tmr_pb[0] = pt
        except Exception as ex:
            rec_status.setText(f"Playback error: {ex}")
            rec_status.setStyleSheet("color:#ff9800;font-size:11px")

    rec_btn.clicked.connect(_start_rec)
    stop_btn.clicked.connect(_stop_rec)

    # Stop any recording when dialog closes
    def _stt_cleanup(_):
        _pb_alive[0] = False            # ← disarm all queued timer callbacks first
        if _tmr_vu[0]: _tmr_vu[0].stop()
        if _tmr_pb[0]: _tmr_pb[0].stop()
        if _stream_ref:
            try: _stream_ref[0].stop(); _stream_ref[0].close()
            except Exception: pass
    dlg.finished.connect(_stt_cleanup)

    def _save_stt():
        CONFIG.setdefault("stt", {}).update({
            "engine":       stt_eng_box.itemData(stt_eng_box.currentIndex()),
            "groq_model":   groq_mdl_box.currentText(),
            "local_model":  local_mdl_box.currentData(),
            "device_index": mic_box.currentData(),
            "mic_gain":     gain_slider.value() / 10.0,
        })
    stt_lay.addStretch()
    tabs.addTab(stt_w, "🎤 STT")

    # ── Bottom: Save All + Close ──────────────────────────────────────────
    close_btn = QPushButton("💾  Save All & Close")
    close_btn.setFixedHeight(36)
    close_btn.setStyleSheet(BTN_PRI)
    def _on_close():
        _save_gen(); _save_mem(); _save_tts(); _save_stt()
        persist_save(win.sd); save_config()
        win._display("All settings saved! [EMOTION: happy] ✨")
        dlg.accept()
    close_btn.clicked.connect(_on_close)
    outer.addWidget(close_btn)
    dlg.setFixedWidth(560)
    dlg.show()
    QTimer.singleShot(80, lambda: dlg.resize(
        560,
        min(dlg.sizeHint().height(), dlg.maximumHeight())
    ))