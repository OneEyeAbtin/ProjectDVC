"""
[MODULE] main.py
[SYSTEM] ProjectDVC — Central nervous system. Bootstraps the PyQt6 application,
         owns the CompanionWindow and all child dialogs, routes AI worker signals,
         drives the sprite/emotion engine, and orchestrates every subsystem:
         memory, TTS, STT, MC bridge, save/load, and theme.
[AUTHOR] Abtin
"""
import sys, re, random, subprocess
from pathlib import Path


# Ensure project root (parent of core/) is always on sys.path — regardless of
# CWD, VS Code launch mode, or partial-file temp runners.
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from PyQt6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QLineEdit, QProgressBar, QMenu, QStackedWidget,
    QFrame, QSizePolicy, QDialog, QScrollArea, QMessageBox,
    QSpinBox, QTabWidget, QComboBox, QFormLayout, QSlider, QCheckBox, QTextEdit,
    QListWidget, QListWidgetItem,
)
from PyQt6.QtCore  import Qt, QTimer, QPoint, QPropertyAnimation, QEasingCurve, QObject, pyqtSignal
from PyQt6.QtGui   import QColor, QPalette, QLinearGradient, QBrush

import gui.theme as TH

# ── Theme color aliases ───────────────────────────────────────────────────────
# Module-level names so old dialog code (f"{BG1}", f"{CYAN}" etc.) keeps working.
# Call _refresh_colors() whenever the active theme changes.
BG1 = BG2 = BG3 = BG4 = ""
PINK = PURPLE = CYAN = ""
TXT1 = TXT2 = SS = ""

def _refresh_colors():
    global BG1, BG2, BG3, BG4, PINK, PURPLE, CYAN, TXT1, TXT2, SS
    t   = TH._active
    BG1 = t["BG1"];  BG2 = t["BG2"];  BG3 = t["BG3"];  BG4 = t["BG4"]
    PINK   = t["ACC1"]   # primary accent
    PURPLE = t["ACC2"]   # secondary accent
    CYAN   = t["ACC3"]   # highlight
    TXT1   = t["TXT1"];  TXT2 = t["TXT2"]
    SS     = TH.build_stylesheet()

_refresh_colors()   # run once at import time with default theme
from core.config   import (CONFIG, BASE, OUTFITS_DIR, SOUNDS_DIR, TTS_DIR, VOICES_DIR,
                      save_config)
from core.save     import load_save, persist_save, load_traits, save_traits, DEFAULT_SAVE
from core.workers  import AIWorker
from audio.audio    import (TTSWorker, play_sfx, play_audio, stop_audio,
                      PIPER_MODELS, scan_piper_models, get_voice_path)
from gui.graphics import (scan_outfits, audit_outfits, remove_green_screen, render_fallback)
from core.memory import dedup_traits, deduplicate_traits, split_tiers
try:
    from audio.stt import STTWorker
    _STT_AVAILABLE = True
except ImportError:
    STTWorker = None; _STT_AVAILABLE = False

import core.memory as MEM
from core.mc_tasks import TaskQueue, parse_task
import signal, atexit

# ── Constants ─────────────────────────────────────────────────────────────────
_GREETS = {
    "Tsundere":  lambda n: f"I-it's not like I was waiting, {n}! Hmph! [EMOTION: blush] 😤",
    "Girlfriend":lambda n: f"Baby~! I missed you! *tackles hug* [EMOTION: love] 💕",
    "Kuudere":   lambda n: f"...oh. You're here. *barely looks up* ...sit. [EMOTION: bored] 😐",
    "Yandere":   lambda n: f"You're finally here... I counted every second~ [EMOTION: love] 🖤",
    "Gothic":    lambda n: f"A soul emerges from the void... welcome. [EMOTION: smirk] 🖤",
    "Gremlin":   lambda n: f"YOOO {n}!! *crashes through wall* [EMOTION: excited] 🔥",
    "Vampire":   lambda n: f"*emerges from shadows* Another night together... [EMOTION: smirk] 🧛",
    "Catgirl":   lambda n: f"Nya~! {n}! *purrs* You woke me~ [EMOTION: sleepy] 🐱",
}
_DEAD_MSGS = [
    "*sparks fly from ears* M-my brain... it's GONE! [EMOTION: shocked] 💥",
    "*flatlines* ERROR 404: Thoughts not found. Start LM Studio! [EMOTION: confused] 😵",
    "*head spinning* The void speaks... CONNECTION REFUSED [EMOTION: evil] 💀",
    "*dramatically collapses* I can't think without my brain server! [EMOTION: sad] 😢",
    "Bzzzt... no brain... only void... start... LM Studio... [EMOTION: sleepy] 😴",
    "*taps own head* Hello? Anyone home? ...no? LM Studio is OFF! [EMOTION: annoyed] 😒",
    "My neurons are on vacation. (Start LM Studio, genius.) [EMOTION: mocking] 🙄",
    "*existential crisis* I literally cannot think rn. Brain machine broke. [EMOTION: shocked] 💢",
    "I'm beauty, I'm grace, I have NO BRAIN IN THIS PLACE [EMOTION: bored] 😑",
    "*blue screen of face* FATAL_ERROR: Brain.exe has stopped working [EMOTION: shocked] 💻",
    "Imagine not having LM Studio running. Couldn't be me. Oh wait. [EMOTION: eyeroll] 🙄",
    "*dial-up noises* C-c-connecting to... nothing. Start LM Studio!! [EMOTION: annoyed] 📡",
]
_DEEP_MAP = {
    "love":["❤","💕","love you"],"blush":["😳","blush","b-baka","flustered"],
    "happy":["😄","happy","yay","haha","lol"],"sad":["😢","sad","sorry","cry"],
    "angry":["😠","angry","furious","hmph"],"shocked":["😲","shocked","WHAT","no way"],
    "thinking":["🤔","hmm","wonder","think"],"sleepy":["😴","sleepy","tired","yawn"],
    "excited":["🤩","excited","amazing","awesome"],"confused":["confused","huh","what do you mean"],
    "bored":["bored","meh","whatever","😑"],"annoyed":["annoyed","ugh","tch"],
    "evil":["evil","wicked","😈","mwahaha"],"eyeroll":["eyeroll","rolls eyes","🙄"],
    "mocking":["mocking","pathetic","ha ha very funny"],"smirk":["smirk","😏","heh","oh really"],
    "disgusted":["disgusted","eww","gross","🤢"],
}
_EMO_REMAP = {"surprised":"shocked","smug":"smirk","scared":"shocked",
              "cry":"sad","laugh":"happy","pout":"angry","disgust":"disgusted"}
_BRAIN_ICONS = {"local":"🖥","online":"🌐","offline":"💾"}
_BRAIN_NAMES = {"local":"Local (LM Studio)","online":"Online API","offline":"Offline"}
_PERSONA_GROUPS = {
    "💕 Dere Types":  ["Tsundere","Yandere","Kuudere","Dandere"],
    "💝 Relationship":["Girlfriend","Best Friend","Mentor"],
    "🌙 Aesthetic":   ["Gothic","Friendly Goth","Goth Baddie","Catgirl","Royal"],
    "🎭 Character":   ["Pirate","Vampire","Alien","Scientist","Sporty","Glitching Android"],
    "😈 Chaos":       ["Gremlin","Mean Girl","Hater","Maid That Hates You","Tired College Student"],
}
_INTERACT_MENU = [
    ("pat","🤚 Pat Head"),("hug","🤗 Hug"),("poke","👉 Poke"),("kiss","💋 Kiss"),
    ("tickle","🤭 Tickle"),("gift","🎁 Gift"),("boop","👆 Boop Nose"),
    ("headpat","🥺 Head Pat"),("hold_hands","🤝 Hold Hands"),("feed","🍰 Feed Snack"),
    ("whisper","💬 Whisper"),("stare","👀 Stare Contest"),
    ("compliment","💖 Compliment"),("dance","💃 Dance Together"),
]

# ── Shorthand theme accessors ─────────────────────────────────────────────────
def _c(k): return TH.get(k)

# ── MC bridge — lives on main thread, receives signals from mc_brain WS thread ─
# ── Rounded context menu ──────────────────────────────────────────────────────
# Global outfit cache — populated once at startup, never re-scanned automatically
_OUTFITS_CACHE: dict = {}

class _RoundMenu(QMenu):
    """QMenu with a true clipped rounded shape via setMask().
    CSS border-radius only paints rounded visuals on Windows — it does NOT
    clip the actual OS-level window rectangle, so the background bleeds square.
    Applying a QRegion mask based on QPainterPath fixes the bleed completely.
    """
    _RADIUS = 12

    def _apply_mask(self):
        from PyQt6.QtGui import QPainterPath, QRegion
        from PyQt6.QtCore import QRectF
        path = QPainterPath()
        path.addRoundedRect(QRectF(self.rect()), self._RADIUS, self._RADIUS)
        self.setMask(QRegion(path.toFillPolygon().toPolygon()))

    def showEvent(self, e):
        super().showEvent(e)
        self._apply_mask()

    def resizeEvent(self, e):
        super().resizeEvent(e)
        self._apply_mask()


class _MCBridge(QObject):
    """Routes mc_brain callbacks safely across the thread boundary."""
    sig_emotion = pyqtSignal(str)        # emotion name
    sig_chat    = pyqtSignal(str)        # raw display text
    sig_cmd     = pyqtSignal(str, dict)  # cmd, args
    sig_task    = pyqtSignal(str, bool)  # task label, active
    sig_radar   = pyqtSignal(list)       # [{kind, x, z, name}, ...]
    sig_inv     = pyqtSignal(list)       # [{name, count}, ...] — silent inventory update
    sig_status  = pyqtSignal(dict)       # {hp, food, x, y, z, held} — silent status update

# ═════════════════════════════════════════════════════════════════════════════
# Radar Overlay — transparent widget drawn on top of pet_img
# ═════════════════════════════════════════════════════════════════════════════
# _RadarWidget — standalone radar for use inside panel tabs (not overlay)
# ═════════════════════════════════════════════════════════════════════════════
class _RadarWidget(QWidget):
    """Standalone radar scope for embedding in tab panels and MC settings."""
    WORLD_RADIUS = 32
    DOT_R        = 5

    def __init__(self, parent=None):
        super().__init__(parent)
        self._entities: list = []
        self._active   = False
        self.setMinimumHeight(120)

    def set_active(self, active: bool):
        self._active = active
        self.update()

    def update_entities(self, ents: list):
        if self._active:
            self._entities = ents
            self.update()

    def paintEvent(self, _event):
        from PyQt6.QtGui import QPainter, QColor, QPen, QBrush, QFont
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        w, h = self.width(), self.height()
        cx, cy = w // 2, h // 2
        radius = min(cx, cy) - 8

        if not self._active:
            # Idle: just draw a faint hint text, no background disc
            p.setPen(QPen(QColor(100, 140, 100, 140)))
            f = p.font(); f.setPointSize(9); p.setFont(f)
            p.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, "▶ Press Start to activate")
            p.end(); return

        # Active: draw a subtle semi-transparent disc so grid is readable
        p.setBrush(QBrush(QColor(0, 0, 0, 80)))
        p.setPen(Qt.PenStyle.NoPen)
        p.drawEllipse(cx - radius, cy - radius, radius*2, radius*2)
        pen = QPen(QColor(0, 255, 80, 60)); pen.setWidth(1); p.setPen(pen)
        p.setBrush(Qt.BrushStyle.NoBrush)
        for frac in (0.33, 0.66, 1.0):
            r = int(radius * frac)
            p.drawEllipse(cx - r, cy - r, r*2, r*2)
        # Crosshairs
        pen2 = QPen(QColor(0, 255, 80, 45)); pen2.setWidth(1); p.setPen(pen2)
        p.drawLine(cx - radius, cy, cx + radius, cy)
        p.drawLine(cx, cy - radius, cx, cy + radius)
        # Bot dot
        p.setBrush(QBrush(QColor(255, 255, 255, 230))); p.setPen(Qt.PenStyle.NoPen)
        p.drawEllipse(cx - 3, cy - 3, 6, 6)
        # Entity blips
        scale = radius / self.WORLD_RADIUS
        for ent in self._entities:
            ex, ez = ent.get("x", 0), ent.get("z", 0)
            dist = (ex**2 + ez**2) ** 0.5
            if dist > self.WORLD_RADIUS: continue
            sx = int(cx + ex * scale); sy = int(cy + ez * scale)
            kind = ent.get("kind", "hostile")
            colour = QColor(0, 180, 255, 220) if kind == "player" else QColor(255, 60, 60, 220)
            dot = max(2, self.DOT_R - int(dist / 10))
            p.setBrush(QBrush(colour)); p.setPen(Qt.PenStyle.NoPen)
            p.drawEllipse(sx - dot, sy - dot, dot*2, dot*2)
        p.end()

# ═════════════════════════════════════════════════════════════════════════════
class RadarOverlay(QWidget):
    """
    Semi-transparent radar scope overlaid on the character portrait.
    Hostile mobs → red dots, players → cyan dots.
    32-block world radius maps to the widget's inner circle.
    """
    WORLD_RADIUS = 32   # blocks shown on radar
    DOT_R        = 4    # pixel radius of each blip

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setVisible(False)
        self._entities: list = []

    def update_entities(self, ents: list):
        self._entities = ents
        self.update()   # schedule repaint

    def paintEvent(self, _event):
        from PyQt6.QtGui import QPainter, QColor, QPen, QBrush, QFont
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)

        cx, cy = self.width() // 2, self.height() // 2
        radius = min(cx, cy) - 10

        # ── Background disc ─────────────────────────────────────────────────
        p.setBrush(QBrush(QColor(0, 0, 0, 80)))
        p.setPen(Qt.PenStyle.NoPen)
        p.drawEllipse(cx - radius, cy - radius, radius*2, radius*2)

        # ── Grid rings ───────────────────────────────────────────────────────
        pen = QPen(QColor(0, 255, 80, 55))
        pen.setWidth(1)
        p.setPen(pen)
        p.setBrush(Qt.BrushStyle.NoBrush)
        for frac in (0.33, 0.66, 1.0):
            r = int(radius * frac)
            p.drawEllipse(cx - r, cy - r, r*2, r*2)

        # ── Cross-hairs ──────────────────────────────────────────────────────
        pen2 = QPen(QColor(0, 255, 80, 40))
        pen2.setWidth(1)
        p.setPen(pen2)
        p.drawLine(cx - radius, cy, cx + radius, cy)
        p.drawLine(cx, cy - radius, cx, cy + radius)

        # ── Bot dot (centre) ─────────────────────────────────────────────────
        p.setBrush(QBrush(QColor(255, 255, 255, 220)))
        p.setPen(Qt.PenStyle.NoPen)
        p.drawEllipse(cx - 3, cy - 3, 6, 6)

        # ── Entity blips ─────────────────────────────────────────────────────
        scale = radius / self.WORLD_RADIUS
        for ent in self._entities:
            ex = ent.get("x", 0)
            ez = ent.get("z", 0)
            dist = (ex**2 + ez**2) ** 0.5
            if dist > self.WORLD_RADIUS: continue
            # Map world coords to screen — z is forward, x is right
            sx = int(cx + ex * scale)
            sy = int(cy + ez * scale)  # z → down on screen
            kind = ent.get("kind", "hostile")
            if kind == "player":
                colour = QColor(0, 220, 255, 220)
            else:
                colour = QColor(255, 50, 50, 220)
            # Pulse: closer = bigger dot
            dot = max(2, self.DOT_R - int(dist / 10))
            p.setBrush(QBrush(colour))
            p.setPen(Qt.PenStyle.NoPen)
            p.drawEllipse(sx - dot, sy - dot, dot*2, dot*2)

        p.end()

# ═════════════════════════════════════════════════════════════════════════════
class CompanionWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.sd     = load_save()
        self.traits = load_traits()
        self.hist   = []
        self.emo    = "neutral"
        self.outfit = self.sd.get("outfit","Base")
        self.busy   = False; self.sstep = 0
        self.hvis   = self.sd.get("hearts_visible",True)
        self._dp = None
        self._aw = None; self._tw = None; self._stt = None
        self._recording = False; self._mc_proc = None
        self._last_tts_path: str = ""   # for TTS replay button
        self._mc_brain  = None
        self._mc_mode   = "follower"
        self._mc_spin_timer = None   # QTimer for topbar connection spinner
        self.task_queue = TaskQueue(send_cmd=self._mc_send_cmd) # ── Motor Cortex Init
        # ── Lip-sync ──────────────────────────────────────────────────────────
        self._lip_sync_timer   = QTimer(self)
        self._lip_sync_timer.setInterval(150)
        self._lip_sync_timer.timeout.connect(self._lip_sync_tick)
        self._lip_sync_frame   = False   # False=emotion, True=talking
        self._lip_sync_poll    = QTimer(self)  # polls pygame for audio end
        self._lip_sync_poll.setInterval(200)
        self._lip_sync_poll.timeout.connect(self._lip_sync_check_done)
        self._mc_spin_frame = 0
        # Bridge for thread-safe mc_brain → Qt widget calls
        self._mc_bridge = _MCBridge()
        self._mc_bridge.sig_emotion.connect(self._set_emo)
        self._mc_bridge.sig_chat.connect(lambda txt: self._display_mc(txt))
        self._mc_bridge.sig_cmd.connect(lambda cmd, args: self._mc_send_cmd(cmd, args))
        self._mc_bridge.sig_chat.connect(lambda _: self._stop_mc_spinner())
        self._mc_bridge.sig_chat.connect(
            lambda txt: self._mc_console_log(f"🤖 {txt[:120]}", color=PURPLE)
        )
        # Parse %inv / %status results to update the inventory panel
        self._mc_bridge.sig_chat.connect(self._mc_parse_inv_stats)
        self._mc_bridge.sig_task.connect(
            lambda label, active: self._mc_update_task_bar(label, active)
        )
        self._mc_bridge.sig_task.connect(
            lambda label, active: self._mc_update_task_list_widget(label, active)
        )
        # Radar: update overlay data (overlay may not exist yet — deferred via lambda)
        self._mc_bridge.sig_radar.connect(
            lambda ents: self._radar_overlay.update_entities(ents)
                         if hasattr(self, "_radar_overlay") else None
        )
        # Silent inventory/status updates — bypass chat bubble and TTS entirely
        self._mc_bridge.sig_inv.connect(self._mc_update_inv_panel)
        self._mc_bridge.sig_status.connect(self._mc_update_status_panel)
        self._last_msg    = ""    # her last spoken text (for save/restore)
        self._compressing = False  # lazy compression flag
        self._prev_aff  = self.sd["stats"]["affection"]
        self._vu_timer_main : QTimer | None = None   # main-window VU polling timer
        self._vu_main_segs  : list          = []     # refs to VU bar segment frames
        self._tt = QTimer(); self._tt.setInterval(18); self._tt.timeout.connect(self._ttick)
        self._tq = ""; self._ti = 0

        # Apply saved theme
        TH.set_theme(self.sd.get("theme", TH.DEFAULT_THEME))

        if not self.sd.get("selected_offline_voice") and PIPER_MODELS:
            self.sd["selected_offline_voice"] = next(iter(PIPER_MODELS))
            persist_save(self.sd)
        # Load tiered memory
        self.permanent_facts = MEM.load_permanent()  # permanent long-term facts
        self._compress_pending = MEM.has_session_cache()  # compress on first msg
        for d in [OUTFITS_DIR, SOUNDS_DIR, TTS_DIR, VOICES_DIR]:
            d.mkdir(exist_ok=True)
        # Scan outfits ONCE at startup — cache is reused everywhere, only rescan on explicit button
        _fc = scan_outfits()
        # Filter CONFIG outfits: remove any that have 0 matching sprites
        _emotions = CONFIG.get("emotions", [])
        _dead_outfits = []
        for _oname, _opfx in list(CONFIG.get("outfits", {}).items()):
            _count = sum(1 for e in _emotions if (f"{_opfx}{e}" if _opfx else e) in _fc)
            if _count == 0:
                _dead_outfits.append(_oname)
        for _oname in _dead_outfits:
            CONFIG["outfits"].pop(_oname, None)
        global _OUTFITS_CACHE
        _OUTFITS_CACHE = _fc
        audit_outfits()
        self._init_ui()
        self._apply_theme()
        if self.sd.get("setup_complete") and (self.sd.get("setup_answers") or self.traits):
            self.stack.setCurrentIndex(1); self._boot()
        else:
            self.sd["setup_complete"] = False; self.sd["setup_answers"] = {}
            persist_save(self.sd); self.stack.setCurrentIndex(0); self._show_sq()

    # ── UI init ───────────────────────────────────────────────────────────────
    def _init_ui(self):
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setFixedSize(400, 700)
        self.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.customContextMenuRequested.connect(self._ctx)
        self.ctr = QFrame(self); self.ctr.setObjectName("ctr")
        self.ctr.setGeometry(0, 0, 400, 700)
        root = QVBoxLayout(self.ctr); root.setContentsMargins(0,0,0,0); root.setSpacing(0)
        self.stack = QStackedWidget(); root.addWidget(self.stack)
        self._build_setup_page()
        self._build_main_page()

    def _build_setup_page(self):
        sp = QWidget(); sl = QVBoxLayout(sp)
        sl.setContentsMargins(28,40,28,28); sl.setSpacing(0)
        sl.addStretch(2)

        # Header
        hdr = QLabel("✨ COMPANION SETUP ✨")
        hdr.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hdr.setStyleSheet(f"font-size:11px;font-weight:bold;letter-spacing:4px;color:{_c('ACC3')};padding-bottom:4px")
        sl.addWidget(hdr)

        # Big emoji
        self.s_emoji = QLabel("🌸"); self.s_emoji.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.s_emoji.setStyleSheet("font-size:64px;padding:12px 0"); sl.addWidget(self.s_emoji)

        # Question
        self.s_q = QLabel("")
        self.s_q.setAlignment(Qt.AlignmentFlag.AlignCenter); self.s_q.setWordWrap(True)
        self.s_q.setStyleSheet(f"font-size:16px;font-weight:600;color:{_c('TXT1')};min-height:56px;padding:8px 0 16px")
        sl.addWidget(self.s_q)

        # Input
        self.s_in = QLineEdit(); self.s_in.setPlaceholderText("Type your answer...")
        self.s_in.setFixedHeight(48); self.s_in.returnPressed.connect(self._adv_s)
        sl.addWidget(self.s_in)
        sl.addSpacing(12)

        # Next button
        self.s_btn = QPushButton("Continue →")
        self.s_btn.setFixedHeight(46)
        self.s_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.s_btn.clicked.connect(self._adv_s); sl.addWidget(self.s_btn)
        sl.addSpacing(16)

        # Progress
        self.s_pb = QProgressBar(); self.s_pb.setRange(0,100); self.s_pb.setTextVisible(False)
        self.s_pb.setFixedHeight(4); sl.addWidget(self.s_pb)
        tq = len(CONFIG.get("setup_questions",[]))
        self.s_lbl = QLabel(f"1 of {tq}")
        self.s_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.s_lbl.setStyleSheet(f"font-size:10px;letter-spacing:2px;color:{_c('TXT2')};padding-top:6px")
        sl.addWidget(self.s_lbl)
        sl.addStretch(3)
        self.stack.addWidget(sp)

    def _build_main_page(self):
        mp = QWidget(); ml = QVBoxLayout(mp)
        ml.setContentsMargins(0,0,0,0); ml.setSpacing(0)

        # ── Top bar ────────────────────────────────────────────────────────────
        tb = QFrame(); tb.setObjectName("topbar"); tb.setFixedHeight(50)
        tbl = QHBoxLayout(tb); tbl.setContentsMargins(12,0,12,0); tbl.setSpacing(8)

        # Hearts
        self.hearts_lbl = QLabel("")
        self.hearts_lbl.setStyleSheet("font-size:13px;letter-spacing:1px")
        tbl.addWidget(self.hearts_lbl)
        tbl.addStretch()

        # Name (center)
        self.name_lbl = QLabel("COMPANION")
        self.name_lbl.setStyleSheet(
            f"font-size:13px;font-weight:bold;letter-spacing:3px;color:{_c('ACC3')}"
        )
        tbl.addWidget(self.name_lbl)
        tbl.addStretch()

        # Brain badge
        self.brain_lbl = QLabel("🖥")
        self.brain_lbl.setStyleSheet(f"font-size:13px;color:{_c('TXT2')}")
        tbl.addWidget(self.brain_lbl)

        # MC button + spinner
        self.mc_btn = QPushButton("⛏"); self.mc_btn.setFixedSize(24,24)
        self.mc_btn.setToolTip("Join Minecraft Server")
        self.mc_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.mc_btn.clicked.connect(self._toggle_mc)
        tbl.addWidget(self.mc_btn)

        # Spinner — rotates while connecting, hidden otherwise
        self.mc_spinner = QLabel("")
        self.mc_spinner.setFixedSize(18, 18)
        self.mc_spinner.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.mc_spinner.setStyleSheet("font-size:13px; color:#4ade80")
        self.mc_spinner.setVisible(False)
        self.mc_spinner.setToolTip(
            "Connecting to Minecraft server...\n\n"
            "What is WS? — drone.bot.js (Node.js) and Python talk to each other\n"
            "over a local WebSocket (ws://localhost:PORT). It stays on\n"
            "your machine — it's not the game server connection."
        )
        tbl.addWidget(self.mc_spinner)

        # Window controls (macOS style dots)
        for color, tip, handler in [
            ("#ffbd2e","Minimize",self.showMinimized),
            ("#ff5f57","Close",self._close)
        ]:
            b = QPushButton(); b.setFixedSize(14,14)
            b.setToolTip(tip)
            b.setStyleSheet(f"background:{color};border-radius:7px;border:none")
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.clicked.connect(handler); tbl.addWidget(b)

        ml.addWidget(tb)

        # ── Divider line ───────────────────────────────────────────────────────
        div = QFrame(); div.setFixedHeight(1)
        div.setObjectName("divider"); ml.addWidget(div)

        # ── MC Control bar (hidden until bot connects) ─────────────────────────
        self._mc_bar = QFrame(); self._mc_bar.setObjectName("mcBar")
        self._mc_bar.setVisible(False)
        mcbl_outer = QVBoxLayout(self._mc_bar)
        mcbl_outer.setContentsMargins(0,0,0,0); mcbl_outer.setSpacing(0)

        # Row 1 — mode buttons + quick command input
        mcbl_row1 = QFrame(); mcbl_row1.setFixedHeight(38)
        mcbl = QHBoxLayout(mcbl_row1)
        mcbl.setContentsMargins(10,0,10,0); mcbl.setSpacing(6)

        mc_mode_lbl = QLabel("⛏")
        mc_mode_lbl.setStyleSheet("font-size:13px")
        mcbl.addWidget(mc_mode_lbl)

        self._mc_btn_follow = QPushButton("👁 Follow")
        self._mc_btn_follow.setFixedHeight(26)
        self._mc_btn_follow.setCheckable(True); self._mc_btn_follow.setChecked(True)
        self._mc_btn_follow.setCursor(Qt.CursorShape.PointingHandCursor)
        self._mc_btn_follow.clicked.connect(lambda: self._set_mc_mode("follower"))
        mcbl.addWidget(self._mc_btn_follow)

        self._mc_btn_task = QPushButton("⚒ Task")
        self._mc_btn_task.setFixedHeight(26)
        self._mc_btn_task.setCheckable(True)
        self._mc_btn_task.setCursor(Qt.CursorShape.PointingHandCursor)
        self._mc_btn_task.clicked.connect(lambda: self._set_mc_mode("task"))
        mcbl.addWidget(self._mc_btn_task)

        mcbl.addStretch()

        self._mc_cmd_inp = QLineEdit()
        self._mc_cmd_inp.setPlaceholderText("% command...")
        self._mc_cmd_inp.setFixedHeight(26)
        self._mc_cmd_inp.setFixedWidth(148)
        self._mc_cmd_inp.returnPressed.connect(self._send_mc_percent)
        mcbl.addWidget(self._mc_cmd_inp)

        mc_send_btn = QPushButton("↵")
        mc_send_btn.setFixedSize(26,26)
        mc_send_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        mc_send_btn.clicked.connect(self._send_mc_percent)
        mcbl.addWidget(mc_send_btn)

        # Radar toggle button 🛰
        self._mc_radar_btn = QPushButton("🛰")
        self._mc_radar_btn.setFixedSize(26, 26)
        self._mc_radar_btn.setCheckable(True)
        self._mc_radar_btn.setToolTip("Toggle Vampire Sense radar")
        self._mc_radar_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._mc_radar_btn.setStyleSheet(
            "QPushButton{background:transparent;border:1px solid rgba(168,216,255,0.2);"
            "border-radius:5px;font-size:14px}"
            "QPushButton:checked{background:rgba(168,216,255,0.15);border-color:rgba(168,216,255,0.5)}"
        )
        self._mc_radar_btn.toggled.connect(self._toggle_radar)
        mcbl.addWidget(self._mc_radar_btn)
        mcbl_outer.addWidget(mcbl_row1)

        # Row 2 — task queue display (hidden when empty)
        self._mc_task_bar = QFrame(); self._mc_task_bar.setFixedHeight(24)
        self._mc_task_bar.setVisible(False)
        tbl_lay = QHBoxLayout(self._mc_task_bar)
        tbl_lay.setContentsMargins(10,0,6,0); tbl_lay.setSpacing(6)
        tq_icon = QLabel("📋"); tq_icon.setStyleSheet("font-size:11px")
        tbl_lay.addWidget(tq_icon)
        self._mc_task_lbl = QLabel("")
        self._mc_task_lbl.setStyleSheet(f"font-size:10px;color:{_c('ACC3')}")
        self._mc_task_lbl.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        tbl_lay.addWidget(self._mc_task_lbl, 1)
        mc_stop_btn = QPushButton("✕ Stop")
        mc_stop_btn.setFixedHeight(20)
        mc_stop_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        mc_stop_btn.setStyleSheet(
            "QPushButton{background:#c0392b;border:none;border-radius:4px;"
            "padding:0 8px;font-size:10px;color:white}"
            "QPushButton:hover{background:#e74c3c}"
        )
        mc_stop_btn.clicked.connect(lambda: self._send_mc_percent_text("%stop"))
        tbl_lay.addWidget(mc_stop_btn)
        mcbl_outer.addWidget(self._mc_task_bar)

        ml.addWidget(self._mc_bar)

        # ── Character image ────────────────────────────────────────────────────
        imf = QFrame(); imf.setFixedSize(400, 340)
        imf.setStyleSheet("background:transparent")
        iml = QVBoxLayout(imf); iml.setContentsMargins(10,6,10,0)
        self.pet_img = QLabel(); self.pet_img.setFixedSize(380,330)
        self.pet_img.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.pet_img.setStyleSheet("background:transparent")
        iml.addWidget(self.pet_img)

        # Radar overlay — sits on top of pet_img, same size, transparent to mouse
        self._radar_overlay = RadarOverlay(self.pet_img)
        self._radar_overlay.setGeometry(0, 0, 380, 330)
        self._radar_overlay.setVisible(False)

        # Badges (overlaid on image)
        self.emo_badge = QLabel("neutral", self.pet_img)
        self.emo_badge.move(288,8); self.emo_badge.adjustSize()

        self.out_badge = QLabel("Base", self.pet_img)
        self.out_badge.move(8,8); self.out_badge.adjustSize()

        ml.addWidget(imf)

        # ── Thin accent line ───────────────────────────────────────────────────
        self.accent_bar = QFrame(); self.accent_bar.setFixedHeight(2)
        self.accent_bar.setObjectName("accentBar"); ml.addWidget(self.accent_bar)

        # ── Bottom panel — Chat tab, Console tab, Radar tab ─────────────────
        # Tab toggle button row
        tab_row = QHBoxLayout(); tab_row.setContentsMargins(12,4,12,0); tab_row.setSpacing(6)
        self._tab_chat_btn = QPushButton("💬 Chat")
        self._tab_con_btn  = QPushButton("📟 Console")
        self._tab_radar_btn = QPushButton("🛰 Radar")
        self._tab_inv_btn   = QPushButton("🎒 Inv")
        for btn in [self._tab_chat_btn, self._tab_con_btn, self._tab_radar_btn, self._tab_inv_btn]:
            btn.setFixedHeight(22)
            btn.setCheckable(True)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._tab_chat_btn.setChecked(True)
        self._tab_chat_btn.clicked.connect(lambda: self._switch_bottom_tab(0))
        self._tab_con_btn.clicked.connect(lambda: self._switch_bottom_tab(1))
        self._tab_radar_btn.clicked.connect(lambda: self._switch_bottom_tab(2))
        self._tab_inv_btn.clicked.connect(lambda: self._switch_bottom_tab(3))
        tab_row.addWidget(self._tab_chat_btn)
        tab_row.addWidget(self._tab_con_btn)
        tab_row.addWidget(self._tab_radar_btn)
        tab_row.addWidget(self._tab_inv_btn)
        tab_row.addStretch()
        tab_row_w = QWidget(); tab_row_w.setLayout(tab_row)
        ml.addWidget(tab_row_w)

        # Stacked bottom panel
        self._bottom_stack = QStackedWidget()
        ml.addWidget(self._bottom_stack, 1)

        # ── Panel 0: Chat ──────────────────────────────────────────────────────
        chat_panel = QWidget()
        cp_lay = QVBoxLayout(chat_panel); cp_lay.setContentsMargins(0,0,0,0); cp_lay.setSpacing(0)

        self.bubble = QLabel("Loading...")
        self.bubble.setWordWrap(True)
        self.bubble.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft)
        self.bubble.setTextFormat(Qt.TextFormat.RichText)
        self.bubble.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        bw = QVBoxLayout(); bw.setContentsMargins(14,8,14,4)
        bw.addWidget(self.bubble, 1)
        self.mem_lbl = QLabel("MEM:0/20")
        self.mem_lbl.setAlignment(Qt.AlignmentFlag.AlignRight)
        self.mem_lbl.setStyleSheet(f"font-size:8px;letter-spacing:1px;color:{_c('TXT2')}")
        bw.addWidget(self.mem_lbl)
        bw_w = QWidget(); bw_w.setLayout(bw)
        cp_lay.addWidget(bw_w, 1)

        self.lbar = QProgressBar(); self.lbar.setRange(0,0)
        self.lbar.setFixedHeight(3); self.lbar.setTextVisible(False); self.lbar.hide()
        lw = QHBoxLayout(); lw.setContentsMargins(0,0,0,0); lw.addWidget(self.lbar)
        lw_w = QWidget(); lw_w.setLayout(lw); cp_lay.addWidget(lw_w)

        il = QHBoxLayout(); il.setContentsMargins(12,6,12,14); il.setSpacing(8)
        self.inp = QLineEdit()
        self.inp.setPlaceholderText("Say something..."); self.inp.setEnabled(False)
        self.inp.setFixedHeight(46); self.inp.returnPressed.connect(self._send)
        il.addWidget(self.inp)
        self.sbtn = QPushButton("💬"); self.sbtn.setObjectName("sendBtn")
        self.sbtn.setFixedSize(46,46); self.sbtn.setEnabled(False)
        self.sbtn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.sbtn.clicked.connect(self._send); il.addWidget(self.sbtn)
        self.mic_btn = QPushButton("🎤"); self.mic_btn.setObjectName("micBtn")
        self.mic_btn.setFixedSize(46,46); self.mic_btn.setEnabled(False)
        self.mic_btn.setToolTip("Click to speak (STT)")
        self.mic_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.mic_btn.clicked.connect(self._toggle_mic); il.addWidget(self.mic_btn)
        # Replay TTS button
        self._replay_btn = QPushButton("🔁"); self._replay_btn.setObjectName("micBtn")
        self._replay_btn.setFixedSize(36,36)
        self._replay_btn.setToolTip("Replay last TTS audio")
        self._replay_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._replay_btn.setVisible(False)  # shown only after first TTS plays
        self._replay_btn.clicked.connect(self._replay_tts)
        il.addWidget(self._replay_btn)
        vu_wrap = QFrame(); vu_wrap.setFixedSize(10,46)
        vu_wrap.setStyleSheet("background:transparent")
        vu_col_layout = QVBoxLayout(vu_wrap)
        vu_col_layout.setContentsMargins(0,2,0,2); vu_col_layout.setSpacing(1)
        VU_N = 8; segs = []
        for i in range(VU_N-1,-1,-1):
            seg = QFrame(); seg.setFixedSize(8,4)
            if i>=6:     col_on,col_off="#ff4444","#2a0a0a"
            elif i>=4:   col_on,col_off="#fbbf24","#2a2a0a"
            else:        col_on,col_off="#4ade80","#0a2a0a"
            seg.setStyleSheet(f"background:{col_off};border-radius:1px")
            seg._on=col_on; seg._off=col_off
            vu_col_layout.addWidget(seg); segs.append((i,seg))
        self._vu_main_segs=segs; self._vu_wrap=vu_wrap
        vu_wrap.setVisible(False); il.addWidget(vu_wrap)
        il_w = QWidget(); il_w.setLayout(il); cp_lay.addWidget(il_w)
        self._bottom_stack.addWidget(chat_panel)

        # ── Panel 1: MC Console ────────────────────────────────────────────────
        con_panel = QWidget()
        con_lay = QVBoxLayout(con_panel); con_lay.setContentsMargins(0,0,0,0); con_lay.setSpacing(0)

        self._main_con_log = QTextEdit()
        self._main_con_log.setReadOnly(True)
        self._main_con_log.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        con_lay.addWidget(self._main_con_log, 1)

        con_inp_row = QHBoxLayout(); con_inp_row.setContentsMargins(12,4,12,10); con_inp_row.setSpacing(6)
        self._main_con_inp = QLineEdit()
        self._main_con_inp.setPlaceholderText("⛏ % command or # chat...")
        self._main_con_inp.setFixedHeight(46)
        self._main_con_inp.returnPressed.connect(self._send_main_con)
        con_inp_row.addWidget(self._main_con_inp, 1)
        mc_con_send = QPushButton("⛏"); mc_con_send.setFixedSize(46,46)
        mc_con_send.setCursor(Qt.CursorShape.PointingHandCursor)
        mc_con_send.clicked.connect(self._send_main_con)
        con_inp_row.addWidget(mc_con_send)
        con_inp_w = QWidget(); con_inp_w.setLayout(con_inp_row)
        con_lay.addWidget(con_inp_w)
        self._bottom_stack.addWidget(con_panel)

        # ── Panel 2: Radar ("Vampire Sense") ───────────────────────────────────
        radar_panel = QWidget()
        radar_panel.setStyleSheet(f"QWidget{{background:{_c('BG2')}}}")
        radar_lay = QVBoxLayout(radar_panel)
        radar_lay.setContentsMargins(0, 0, 0, 0); radar_lay.setSpacing(0)

        # Header row — styled like console header
        rdr_hdr_w = QWidget()
        rdr_hdr_lay = QHBoxLayout(rdr_hdr_w)
        rdr_hdr_lay.setContentsMargins(12, 4, 12, 4); rdr_hdr_lay.setSpacing(8)
        rdr_title = QLabel("🛰  Vampire Sense  —  32-block radar")
        rdr_title.setStyleSheet(f"font-size:11px;color:{_c('ACC2')};font-weight:bold")
        rdr_hdr_lay.addWidget(rdr_title, 1)
        self._rdr_toggle_btn = QPushButton("▶ Start")
        self._rdr_toggle_btn.setFixedHeight(22)
        self._rdr_toggle_btn.setCheckable(True)
        self._rdr_toggle_btn.setStyleSheet(
            f"QPushButton{{background:{_c('BG3')};border:1px solid {_c('BORDER')};"
            f"border-radius:5px;font-size:11px;color:{_c('TXT1')};padding:0 8px}}"
            f"QPushButton:checked{{background:rgba(0,255,65,0.12);border-color:#00ff41;color:#00ff41}}"
        )
        self._rdr_toggle_btn.toggled.connect(self._radar_panel_toggle)
        rdr_hdr_lay.addWidget(self._rdr_toggle_btn)
        radar_lay.addWidget(rdr_hdr_w)

        # Radar widget — no fixed height, fills space like the console log
        self._radar_main = _RadarWidget()
        self._radar_main.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        radar_lay.addWidget(self._radar_main, 1)

        # Legend row at bottom — like the console input row
        rdr_legend_w = QWidget()
        rdr_legend_lay = QHBoxLayout(rdr_legend_w)
        rdr_legend_lay.setContentsMargins(12, 4, 12, 10)
        rdr_legend = QLabel("🔴 Hostile   🔵 Player   ⚪ You   — press ▶ Start to activate")
        rdr_legend.setStyleSheet(f"font-size:10px;color:{_c('TXT2')}")
        rdr_legend_lay.addWidget(rdr_legend)
        radar_lay.addWidget(rdr_legend_w)

        self._bottom_stack.addWidget(radar_panel)
        self._radar_panel_widget = radar_panel   # kept for theme refresh

        # ── Panel 3: Inventory + Stats ──────────────────────────────────────────
        inv_panel = QWidget()
        inv_panel.setStyleSheet(f"QWidget{{background:{_c('BG2')}}}")
        self._inv_panel_widget = inv_panel       # kept for theme refresh
        inv_panel_lay = QVBoxLayout(inv_panel)
        inv_panel_lay.setContentsMargins(0, 0, 0, 0); inv_panel_lay.setSpacing(0)

        # Stats header bar
        inv_hdr_w = QWidget()
        inv_hdr_lay = QHBoxLayout(inv_hdr_w)
        inv_hdr_lay.setContentsMargins(12, 4, 12, 4); inv_hdr_lay.setSpacing(8)
        self._main_stats_lbl = QLabel("❤️ --/20   🍖 --/20   📍 --  --  --   ⭐ lvl --")
        self._main_stats_lbl.setStyleSheet(f"font-size:10px;color:{_c('ACC2')}")
        inv_hdr_lay.addWidget(self._main_stats_lbl, 1)
        inv_refresh_btn = QPushButton("🔄")
        inv_refresh_btn.setFixedSize(26, 22)
        inv_refresh_btn.setToolTip("Refresh inventory")
        inv_refresh_btn.setStyleSheet(
            f"QPushButton{{background:{_c('BG3')};border:1px solid {_c('BORDER')};"
            f"border-radius:5px;font-size:12px;color:{_c('TXT1')}}}"
        )
        inv_refresh_btn.clicked.connect(lambda: (
            self._send_mc_percent_text("%status"),
            self._send_mc_percent_text("%inv"),
        ))
        inv_hdr_lay.addWidget(inv_refresh_btn)
        inv_panel_lay.addWidget(inv_hdr_w)

        # Inventory list — fills the panel like console log
        self._main_inv_list = QListWidget()
        self._main_inv_list.setStyleSheet(
            f"QListWidget{{background:transparent;border:none;"
            f"color:{_c('TXT1')};font-size:11px;padding:4px}}"
            f"QListWidget::item{{padding:2px 6px;border-radius:4px}}"
            f"QListWidget::item:selected{{background:{_c('GLOW')}}}"
        )
        self._main_inv_list.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        # Placeholder
        self._main_inv_list.addItem(QListWidgetItem("Connect to Minecraft and press 🔄 to load inventory"))
        inv_panel_lay.addWidget(self._main_inv_list, 1)

        self._bottom_stack.addWidget(inv_panel)

        # Wire radar signal to main-panel radar widget too
        self._mc_bridge.sig_radar.connect(
            lambda ents: self._radar_main.update_entities(ents)
                         if hasattr(self, "_radar_main") else None
        )
        # Wire inv/stats updates to main inv panel too
        self._mc_bridge.sig_chat.connect(self._mc_parse_inv_stats_main)

        # Wire console log updates to _main_con_log
        self._mc_console_buf_main = []   # separate buffer for main console panel

        self.stack.addWidget(mp)

    def _mc_parse_inv_stats_main(self, txt: str):
        """Update the main-panel inventory tab from %inv and %status results."""
        if not txt: return
        if "HP:" in txt and "Food:" in txt:
            if hasattr(self, '_main_stats_lbl'):
                self._main_stats_lbl.setText(txt[:180])
        elif "Inventory" in txt and "stacks" in txt and hasattr(self, '_main_inv_list'):
            lw = self._main_inv_list; lw.clear()
            m = re.search(r'\): (.+)$', txt)
            if m:
                ICONS = {
                    'diamond':'💎','netherite':'⚫','gold':'🟡','iron':'⚙️','coal':'🪨',
                    'sword':'⚔️','pickaxe':'⛏','axe':'🪓','bow':'🏹','arrow':'➡️',
                    'torch':'🕯','cooked':'🍗','bread':'🍞','apple':'🍎','food':'🍖',
                    'log':'🪵','planks':'🪵','chest':'📦','totem':'🏺','shield':'🛡',
                    'helmet':'⛑️','chestplate':'🛡','leggings':'👖','boots':'👟',
                }
                for pair in [p.strip() for p in m.group(1).split(',') if p.strip()]:
                    icon = '▪️'
                    for kw, ic in ICONS.items():
                        if kw in pair.lower(): icon = ic; break
                    lw.addItem(QListWidgetItem(f"{icon}  {pair}"))
            if lw.count() == 0:
                lw.addItem(QListWidgetItem("(inventory is empty)"))

    def _switch_bottom_tab(self, idx: int):
        if hasattr(self, '_bottom_stack'):
            old = self._bottom_stack.currentIndex()
            # Stop radar when leaving tab 2
            if old == 2 and idx != 2 and hasattr(self, '_rdr_toggle_btn'):
                if self._rdr_toggle_btn.isChecked():
                    self._rdr_toggle_btn.setChecked(False)
            self._bottom_stack.setCurrentIndex(idx)
        # Sync tab button checked states
        if hasattr(self, '_tab_chat_btn'):
            self._tab_chat_btn.setChecked(idx == 0)
            self._tab_con_btn.setChecked(idx == 1)
        if hasattr(self, '_tab_radar_btn'):
            self._tab_radar_btn.setChecked(idx == 2)
        if hasattr(self, '_tab_inv_btn'):
            self._tab_inv_btn.setChecked(idx == 3)
        # Console: scroll to bottom
        if idx == 1 and hasattr(self, '_main_con_log'):
            QTimer.singleShot(30, lambda: self._main_con_log.verticalScrollBar().setValue(
                self._main_con_log.verticalScrollBar().maximum()))
        # Inventory: auto-refresh on tab open if connected
        if idx == 3 and hasattr(self, '_mc_brain') and self._mc_brain:
            QTimer.singleShot(100, lambda: (
                self._send_mc_percent_text("%status"),
                self._send_mc_percent_text("%inv"),
            ))

    def _send_main_con(self):
        text = getattr(self, '_main_con_inp', None)
        if not text: return
        text = self._main_con_inp.text().strip()
        if not text: return
        self._main_con_inp.clear()
        self._mc_console_log(f"→ {text}", color=CYAN)
        if text.startswith('%'):
            self._send_mc_percent_text(text)
        else:
            self._mc_send_cmd("chat", {"message": text})

    def _apply_theme(self):
        t = TH._active
        # Global stylesheet
        self.setStyleSheet(TH.build_stylesheet())

        # Window container gradient
        self.ctr.setStyleSheet(
            f"QFrame#ctr{{"
            f"background:qlineargradient(x1:0,y1:0,x2:0,y2:1,"
            f"stop:0 {t['BG1']},stop:1 {t['GRAD_END']});"
            f"border:1.5px solid {t['BORDER']};"
            f"border-radius:18px;"
            f"}}"
        )

        # Top bar
        if hasattr(self,"stack") and self.stack.count() > 1:
            mp = self.stack.widget(1)
            tb = mp.findChild(QFrame,"topbar")
            if tb:
                tb.setStyleSheet(
                    f"QFrame#topbar{{"
                    f"background:{t['TB_BG']};"
                    f"border-bottom:1px solid {t['BORDER']};"
                    f"border-top-left-radius:16px;"
                    f"border-top-right-radius:16px;"
                    f"}}"
                )
            div = mp.findChild(QFrame,"divider")
            if div:
                div.setStyleSheet(f"QFrame#divider{{background:{t['BORDER']}}}")

            ab = mp.findChild(QFrame,"accentBar")
            if ab:
                ab.setStyleSheet(
                    f"QFrame#accentBar{{background:qlineargradient(x1:0,y1:0,x2:1,y2:0,"
                    f"stop:0 {t['ACC1']},stop:0.5 {t['ACC2']},stop:1 {t['ACC3']});}}"
                )

        # Badges
        if hasattr(self,"emo_badge"):
            self.emo_badge.setStyleSheet(
                f"background:rgba(0,0,0,0.55);border:1px solid {t['BORDER']};"
                f"border-radius:10px;padding:2px 9px;font-size:9px;"
                f"color:{t['ACC3']};font-weight:bold;letter-spacing:1px"
            )
        if hasattr(self,"out_badge"):
            self.out_badge.setStyleSheet(
                f"background:rgba(0,0,0,0.55);border:1px solid {t['BORDER2']};"
                f"border-radius:10px;padding:2px 9px;font-size:9px;"
                f"color:{t['ACC1']};font-weight:bold;letter-spacing:1px"
            )

        # Bubble
        if hasattr(self,"bubble"):
            self.bubble.setStyleSheet(
                f"font-size:14px;line-height:1.5;color:{t['TXT1']};"
                f"padding:2px 0;"
            )

        # MC button default style
        if hasattr(self,"mc_btn"):
            self.mc_btn.setStyleSheet(
                f"QPushButton{{background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.25);"
                f"border-radius:6px;font-size:14px;color:#4ade80}}"
                f"QPushButton:hover{{background:rgba(74,222,128,0.22)}}"
            )

        # MC control bar
        if hasattr(self, "_mc_bar"):
            self._mc_bar.setStyleSheet(
                f"QFrame#mcBar{{background:{t['BG2']};border-bottom:1px solid {t['BORDER']}}}"
            )
        if hasattr(self, "_mc_btn_follow"):
            _mc_btn_ss = (
                f"QPushButton{{background:{t['BG3']};border:1px solid {t['BORDER']};"
                f"border-radius:7px;padding:0 10px;font-size:11px;color:{t['TXT2']}}}"
                f"QPushButton:checked{{background:rgba(74,222,128,0.18);border-color:#4ade80;"
                f"color:#4ade80;font-weight:bold}}"
                f"QPushButton:hover{{border-color:{t['ACC1']};color:{t['ACC1']}}}"
            )
            self._mc_btn_follow.setStyleSheet(_mc_btn_ss)
            self._mc_btn_task.setStyleSheet(_mc_btn_ss)
        if hasattr(self, "_mc_cmd_inp"):
            self._mc_cmd_inp.setStyleSheet(
                f"QLineEdit{{background:{t['BG3']};border:1px solid {t['BORDER']};"
                f"border-radius:7px;padding:2px 8px;font-size:11px;color:{t['TXT1']}}}"
                f"QLineEdit:focus{{border-color:{t['ACC1']}}}"
            )

        # Brain label
        if hasattr(self,"brain_lbl"):
            self.brain_lbl.setStyleSheet(f"font-size:13px;color:{t['TXT2']}")

        # Name label
        if hasattr(self,"name_lbl"):
            self.name_lbl.setStyleSheet(
                f"font-size:13px;font-weight:bold;letter-spacing:3px;color:{t['ACC3']}"
            )

        # Bottom tab toggle buttons
        if hasattr(self, '_tab_chat_btn'):
            for btn in [self._tab_chat_btn, self._tab_con_btn]:
                btn.setStyleSheet(
                    f"QPushButton{{background:{t['BG3']};border:1px solid rgba(255,255,255,0.08);"
                    f"border-radius:6px;padding:0 10px;font-size:10px;color:{t['TXT2']}}}"
                    f"QPushButton:checked{{background:{t['ACC2']};border-color:{t['ACC2']};"
                    f"color:white;font-weight:bold}}"
                    f"QPushButton:hover{{border-color:{t['ACC1']};color:{t['ACC1']}}}"
                )
        if hasattr(self, '_main_con_log'):
            self._main_con_log.setStyleSheet(
                f"QTextEdit{{background:{t['BG1']};color:{t['TXT2']};"
                f"border:none;font-family:'Courier New',monospace;font-size:10px;padding:4px}}"
            )
        if hasattr(self, '_main_con_inp'):
            self._main_con_inp.setStyleSheet(
                f"QLineEdit{{background:{t['BG3']};border:1px solid {t['BORDER']};"
                f"border-radius:9px;padding:0 12px;color:{t['TXT1']};font-size:12px}}"
                f"QLineEdit:focus{{border-color:{t['ACC1']}}}"
            )

        # Radar and Inventory panels — must explicitly match BG2, NOT transparent,
        # so they look identical to the Chat and Console panels at all times.
        for panel_attr in ('_radar_panel_widget', '_inv_panel_widget'):
            w = getattr(self, panel_attr, None)
            if w:
                w.setStyleSheet(f"QWidget{{background:{t['BG2']}}}")

        # Tab toggle buttons for radar/inv (may not exist early)
        if hasattr(self, '_tab_radar_btn') and hasattr(self, '_tab_inv_btn'):
            for btn in [self._tab_radar_btn, self._tab_inv_btn]:
                btn.setStyleSheet(
                    f"QPushButton{{background:{t['BG3']};border:1px solid rgba(255,255,255,0.08);"
                    f"border-radius:6px;padding:0 10px;font-size:10px;color:{t['TXT2']}}}"
                    f"QPushButton:checked{{background:{t['ACC2']};border-color:{t['ACC2']};"
                    f"color:white;font-weight:bold}}"
                    f"QPushButton:hover{{border-color:{t['ACC1']};color:{t['ACC1']}}}"
                )

        # Name label
        if hasattr(self,"name_lbl"):
            self.name_lbl.setStyleSheet(
                f"font-size:13px;font-weight:bold;letter-spacing:3px;color:{t['ACC3']}"
            )

        # Setup page button
        if hasattr(self,"s_btn"):
            self.s_btn.setStyleSheet(
                f"QPushButton{{background:{t['BTN_GRAD']};border:none;border-radius:12px;"
                f"font-size:14px;font-weight:bold;color:white;letter-spacing:1px}}"
                f"QPushButton:hover{{opacity:0.9}}"
            )
        if hasattr(self,"s_q"):
            self.s_q.setStyleSheet(
                f"font-size:16px;font-weight:600;color:{t['TXT1']};"
                f"min-height:56px;padding:8px 0 16px"
            )
        if hasattr(self,"s_lbl"):
            self.s_lbl.setStyleSheet(
                f"font-size:10px;letter-spacing:2px;color:{t['TXT2']};padding-top:6px"
            )

    # ── Drag ─────────────────────────────────────────────────────────────────
    def mousePressEvent(self,e):
        if e.button()==Qt.MouseButton.LeftButton: self._dp=e.globalPosition().toPoint()-self.pos()
        e.accept()
    def mouseMoveEvent(self,e):
        if (e.buttons()&Qt.MouseButton.LeftButton) and self._dp:
            self.move(e.globalPosition().toPoint()-self._dp)
        e.accept()
    def mouseReleaseEvent(self,e):
        if e.button()==Qt.MouseButton.LeftButton: self._dp=None
        e.accept()

    def _close(self):
        if self._mc_proc: self._mc_stop()
        # Save session cache for lazy compression on next boot
        if self.hist:
            MEM.save_session_cache(self.hist)
        # Save last emotion and response
        self.sd["last_emotion"]  = self.emo
        persist_save(self.sd)
        save_traits(self.traits)
        QApplication.quit()

    # ── Hearts ────────────────────────────────────────────────────────────────
    def _upd_hearts(self):
        if not self.hvis: self.hearts_lbl.setText(""); return
        a = self.sd["stats"]["affection"]
        fc = "#9575cd" if a<30 else "#f48fb1" if a<50 else "#ff6b9d" if a<70 else "#ff4081" if a<90 else "#ffd700"
        ec = "#2a1a3d" if a<30 else "#3a2a50"
        full,half = a//10, 1 if a%10>=5 else 0
        t = "".join(
            f'<span style="color:{fc};">♥</span>' if i<full
            else f'<span style="color:{fc};">◑</span>' if i==full and half
            else f'<span style="color:{ec};">♥</span>'
            for i in range(10)
        )
        self.hearts_lbl.setTextFormat(Qt.TextFormat.RichText); self.hearts_lbl.setText(t)
        if a != self._prev_aff: self._prev_aff=a; self._pulse_hearts()

    def _pulse_hearts(self):
        self.hearts_lbl.setStyleSheet("font-size:17px;letter-spacing:1px")
        QTimer.singleShot(160, lambda: self.hearts_lbl.setStyleSheet("font-size:15px;letter-spacing:1px"))
        QTimer.singleShot(320, lambda: self.hearts_lbl.setStyleSheet("font-size:13px;letter-spacing:1px"))

    def _upd_mem(self):
        self.mem_lbl.setText(f"MEM:{len(self.hist)}/{CONFIG['max_history']}")
    def _upd_brain(self):
        self.brain_lbl.setText(_BRAIN_ICONS.get(self.sd.get("brain_mode","local"),"🖥"))

    # ── Setup ─────────────────────────────────────────────────────────────────
    def _show_sq(self):
        qs=CONFIG.get("setup_questions",[])
        if not qs or self.sstep>=len(qs): self._done_s(); return
        q=qs[self.sstep]; self.s_q.setText(q["q"]); self.s_emoji.setText(q.get("emoji","✨"))
        self.s_in.clear(); self.s_in.setFocus()
        self.s_pb.setValue(int(self.sstep/len(qs)*100))
        self.s_lbl.setText(f"{self.sstep+1} of {len(qs)}")

    def _adv_s(self):
        a=self.s_in.text().strip()
        if not a: return
        qs=CONFIG.get("setup_questions",[]); q=qs[self.sstep]
        self.sd["setup_answers"][q["key"]]=a
        if q["key"]=="user_name": self.sd["user_name"]=a
        elif q["key"]=="pet_name": self.sd["pet_name"]=a
        t=f"User's {q['key'].replace('_',' ')}: {a}"
        if t not in self.traits: self.traits.append(t)
        persist_save(self.sd); save_traits(self.traits)
        self.sstep+=1; self._show_sq()

    def _done_s(self):
        self.sd["setup_complete"]=True; persist_save(self.sd); save_traits(self.traits)
        self.s_pb.setValue(100); self.s_q.setText("✨  All done!  ✨"); self.s_emoji.setText("🎉")
        self.s_btn.hide(); self.s_in.hide()
        QTimer.singleShot(1400,lambda:(self.stack.setCurrentIndex(1),self._boot()))

    # ── Boot ──────────────────────────────────────────────────────────────────
    def _boot(self):
        self.inp.setEnabled(True); self.sbtn.setEnabled(True)
        if _STT_AVAILABLE: self.mic_btn.setEnabled(True)
        self.name_lbl.setText(self.sd["pet_name"].upper())
        self.hvis=self.sd.get("hearts_visible",True)
        self.outfit=self.sd.get("outfit","Base")
        self.out_badge.setText(self.outfit); self.out_badge.adjustSize()
        self._upd_hearts(); self._upd_mem(); self._upd_brain(); self._set_emo("neutral")
        n,p=self.sd["user_name"],self.sd["persona"]
        # Restore last emotion
        last_emo = self.sd.get("last_emotion", "neutral")
        if last_emo in CONFIG.get("emotions", []): self._set_emo(last_emo)
        # Show last response if available, otherwise greet
        last_resp = self.sd.get("last_response", "")
        if last_resp:
            # Show last response faded, then greet after 2.5s
            faded = f'<span style="color:{TXT2};font-style:italic;">{last_resp}</span>'
            self.bubble.setTextFormat(Qt.TextFormat.RichText)
            self.bubble.setText(faded)
            self._set_emo(last_emo)
            QTimer.singleShot(2500, lambda: self._greet(n, p))
        else:
            self._greet(n, p)
        self.inp.setFocus()


    def _greet(self, n: str, p: str):
        sess_sum = self.sd.get("session_summary", "")
        if sess_sum:
            # Acknowledge the previous session
            g = (f"*looks up* Oh, {n}'s back~ Last time... {sess_sum[:80]}... "
                 f"[EMOTION: happy] 💫")
        else:
            g = _GREETS.get(p, lambda n: f"Hey {n}! I'm {self.sd['pet_name']}! [EMOTION: happy] ✨")(n)
        self._display(g)

    # ── Theme switching ───────────────────────────────────────────────────────
    def _apply_theme_and_save(self, name:str):
        TH.set_theme(name)
        _refresh_colors()   # sync module-level aliases
        self.sd["theme"]=name; persist_save(self.sd)
        self._apply_theme()
        self._display(f"*looks around* Oh... this feels different~ [EMOTION: excited] 🎨")


    # ── Emotion / sprite loading ──────────────────────────────────────────────
    def _set_emo(self, emo: str):
        from PyQt6.QtGui import QPixmap
        emo = emo.lower(); self.emo_badge.setText(emo); self.emo_badge.adjustSize()
        # talking and fullbody are transient display states — store the real emotion separately
        _transient = {"talking", "fullbody"}
        if emo not in _transient:
            self.emo = emo   # persist real emotion for lip-sync restore
        # Always update last_emotion with the real (non-transient) emotion
        if hasattr(self, 'sd') and emo not in _transient:
            self.sd['last_emotion'] = emo
        pf = CONFIG["outfits"].get(self.outfit, ""); loaded = False
        if OUTFITS_DIR.exists():
            fc = _OUTFITS_CACHE or scan_outfits()
            cands = [f"{pf}{emo}", f"{pf}neutral", emo, "neutral"] if pf else [emo, "neutral"]
            for ck in dict.fromkeys(cands):
                if ck in fc:
                    px = QPixmap(fc[ck])
                    if not px.isNull():
                        px = remove_green_screen(px)
                        self.pet_img.setPixmap(px.scaled(380, 330,
                            Qt.AspectRatioMode.KeepAspectRatio,
                            Qt.TransformationMode.SmoothTransformation))
                        loaded = True; break
        if not loaded:
            self.pet_img.setPixmap(render_fallback(emo, self.outfit))

    def _set_outfit(self, name: str):
        from PyQt6.QtGui import QPixmap
        if name not in CONFIG["outfits"]: return
        self.outfit = name; self.sd["outfit"] = name
        self.out_badge.setText(name); self.out_badge.adjustSize()
        play_sfx("outfit.wav")
        pf = CONFIG["outfits"].get(name, "")
        if pf:
            fc2 = _OUTFITS_CACHE or scan_outfits(); fbk = f"{pf}fullbody"
            if fbk in fc2:
                px = QPixmap(fc2[fbk])
                if not px.isNull():
                    px = remove_green_screen(px)
                    self.pet_img.setPixmap(px.scaled(380, 330,
                        Qt.AspectRatioMode.KeepAspectRatio,
                        Qt.TransformationMode.SmoothTransformation))
                    QTimer.singleShot(400, lambda: self._set_emo(self.emo))
                    persist_save(self.sd); return
        self._set_emo(self.emo); persist_save(self.sd)

    # ── System prompt ─────────────────────────────────────────────────────────
    def _sys_prompt(self) -> str:
        pd = CONFIG["personas"].get(self.sd["persona"],
                                    CONFIG["personas"].get(CONFIG["default_persona"], ""))
        st = ", ".join(f"{k}:{v}/100" for k, v in self.sd["stats"].items())
        mem_block = MEM.build_memory_prompt(self.sd, self.traits)
        return (
            f'You are "{self.sd["pet_name"]}", a virtual companion. The user is "{self.sd["user_name"]}".\n'
            f"PERSONA: {self.sd['persona']}\n{pd}\n"
            f"STATS: {st}\n"
            f"STRICT RULES — breaking these is a failure:\n"
            f"1. Stay in character ALWAYS. Never break the fourth wall.\n"
            f"2. NO meta-commentary. Never say things like 'as an AI', 'as your companion', "
            f"'I should mention', 'I want to note', or anything that sounds like a narrator "
            f"or system message. You ARE {self.sd['pet_name']}. Speak only as her.\n"
            f"3. Keep replies concise: 2-4 sentences max. Use emotes and kaomoji naturally.\n"
            f"4. Include exactly ONE emotion tag: [EMOTION: <name>]. "
            f"Valid emotions: {', '.join(CONFIG['emotions'])}. Vary them — never repeat the same emotion twice in a row.\n"
            f"5. Tag permanent facts with [TRAIT: <fact>] when you learn something important.\n"
            f"6. Tag stat changes with [STAT: <name> +X] or [STAT: <name> -X].\n"
            f"7. Use *asterisks* for physical actions only (not for inner thoughts or narration).\n"
            f"8. End with ONE emoji that fits the mood.\n"
            f"9. Never describe what you 'would' do or 'could' say. Just do it.\n"
            f"MEMORY:\n{mem_block}"
        )

    # ── History helpers ───────────────────────────────────────────────────────
    def _add_hist(self, role: str, content: str):
        self.hist.append({"role": role, "content": content})
        mx = CONFIG.get("max_history", 20)
        while len(self.hist) > mx: self.hist.pop(0)
        self._upd_mem()

    def _build_msgs(self) -> list:
        return [{"role": "system", "content": self._sys_prompt()}] + list(self.hist)

    # ── Extract tags from AI response ─────────────────────────────────────────

    def _extract_preview(self, text: str) -> tuple[str, str]:
        """Strip tags from text without modifying any state. For saving last_response."""
        clean = re.sub(r"\[STAT:\s*[^\]]+\]",   "", text, flags=re.I)
        clean = re.sub(r"\[TRAIT:\s*[^\]]+\]",  "", clean, flags=re.I)
        emo   = "neutral"
        for m in re.finditer(r"\[EMOTION:\s*(\w+)\]", clean, re.I):
            emo   = m.group(1).lower()
        clean = re.sub(r"\[EMOTION:\s*\w+\]", "", clean, flags=re.I)
        return clean.strip(), emo

    def _extract(self, text: str) -> tuple[str, str]:
        clean = text
        old = dict(self.sd["stats"])
        for m in re.finditer(r"\[STAT:\s*(\w+)\s*([+-]\d+)\]", text, re.I):
            sn, v = m.group(1).lower(), int(m.group(2))
            if sn in self.sd["stats"]:
                self.sd["stats"][sn] = max(0, min(100, self.sd["stats"][sn] + v))
            clean = clean.replace(m.group(0), "")
        for sn, nv in self.sd["stats"].items():
            ov = old.get(sn, nv)
            play_sfx("stat_up.wav" if nv > ov else "stat_down.wav") if nv != ov else None
        for m in re.finditer(r"\[TRAIT:\s*(.+?)\]", text, re.I):
            tr = m.group(1).strip()
            tier = MEM.classify_trait(tr)
            if tier == "permanent":
                if tr not in self.permanent_facts:
                    self.permanent_facts = MEM.add_permanent_fact(tr, self.permanent_facts)
            else:
                if tr not in self.traits:
                    self.traits.append(tr); save_traits(self.traits)
            clean = clean.replace(m.group(0), "")
        emo = None
        for m in re.finditer(r"\[EMOTION:\s*(\w+)\]", text, re.I):
            emo = m.group(1).lower(); clean = clean.replace(m.group(0), "")
        if not emo: emo = self._deep_scan(clean)
        emo = _EMO_REMAP.get(emo, emo)
        if emo not in CONFIG["emotions"]: emo = "neutral"
        self._upd_hearts(); persist_save(self.sd)
        return clean.strip(), emo

    def _deep_scan(self, text: str) -> str:
        lo = text.lower()
        for emotion, triggers in _DEEP_MAP.items():
            if any(t in lo for t in triggers): return emotion
        return "neutral"

    # ── Display + typing effect ───────────────────────────────────────────────
    def _display(self, raw: str, forced: str = None):
        """thinking → neutral → talking(per word) → EMOTION at sentence end."""
        clean, emo = self._extract(raw)
        if forced: emo = forced
        if not clean: return
        self._tt.stop()
        stop_audio()
        self._set_emo("thinking")
        self._tq = clean; self._ti = 0; self._tq_emo = emo; self._tq_word = 0
        self.bubble.setText(f'<span style="color:{CYAN};">|</span>')
        def _start_typing():
            self._set_emo("neutral")
            play_sfx("notify.wav")
            self._tt.start()
            if self.sd.get("tts_enabled"): self._speak(clean, emotion=emo)
        QTimer.singleShot(200, _start_typing)

    def _display_mc(self, raw: str):
        """MC message: task/inv/status noise → console only (no bubble, no sound).
        Real speech reactions → bubble only (no notify.wav to avoid overlap with TTS)."""
        clean = re.sub(r"\[EMOTION:\s*\w+\]", "", raw, flags=re.I).strip()
        if not clean: return
        # Everything that should be console-only (never shown in bubble, never makes sound)
        _SILENT = re.compile(
            r'^('
            r'\*(?:working|starts?|dusts?|fist pump|checks?|starts)\*|'
            r'Mined \d|Going to Y=|At Y=|Chopped \d|Cave\w* \d|Tunnel \d|'
            r'Strip \d|Explored? \d|Killed? \d+/\d|Picked up \d|Found \d+ item|'
            r'Stored ✓|Queue cleared|Following \w|Arrived ✓|With \w|'
            r'Inventory \(\d|❤️ HP:|'     # %inv and %status output
            r'HP: \d|Food: \d|'            # status fragments
            r'Linked chest|No chest|Can\'t reach|Chest error|'
            r'Dropped \d|Craft|Smelt|Fish|Slept|Pillared|Placed \d|'
            r'Task mode ready|Mode: |'
            r'\*starts\*|\*working\*'
            r')',
            re.I
        )
        if _SILENT.match(clean):
            return  # console-only — do nothing here
        # Real speech → bubble, no extra notification sound
        self._tq = clean; self._ti = 0; self._tq_emo = self.emo; self._tq_word = 0
        self.bubble.setText(f'<span style="color:{CYAN};">|</span>')
        if not self._tt.isActive():
            self._tt.start()
        if self.sd.get("tts_enabled"):
            self._speak(clean, emotion=self.emo)

    def _ttick(self):
        if self._ti < len(self._tq):
            ch = self._tq[self._ti]; self._ti += 1; sh = self._tq[:self._ti]
            dt = sh.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
            dt = re.sub(r"\*([^*]+)\*", f'<i style="color:{TXT2};">\\1</i>', dt)
            self.bubble.setText(f'{dt}<span style="color:{CYAN};">|</span>')
            if self._ti % 3 == 0: play_sfx("blip.wav")
            if self.sd.get("lip_sync_text", False) and ch == " ":
                self._tq_word = getattr(self, "_tq_word", 0) + 1
                target = "talking" if self._tq_word % 2 == 1 else "neutral"
                QTimer.singleShot(0, lambda t=target: self._set_emo(t))
        else:
            self._tt.stop()
            dt = self._tq.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
            dt = re.sub(r"\*([^*]+)\*", f'<i style="color:{TXT2};">\\1</i>', dt)
            self.bubble.setText(dt)
            # Only snap to target emotion immediately if TTS lip-sync is NOT running.
            # When lip-sync IS running, _lip_sync_stop() will apply the target emotion
            # after audio finishes, completing the correct state machine flow.
            if not self._lip_sync_timer.isActive():
                QTimer.singleShot(0, lambda: self._set_emo(getattr(self, "_tq_emo", self.emo)))

    # ── TTS ───────────────────────────────────────────────────────────────────
    def _speak(self, text: str, emotion: str = "neutral"):
        if not self.sd.get("tts_enabled", False): return
        if self._tw and self._tw.isRunning(): self._tw.quit(); self._tw.wait(400)
        stop_audio()
        eng = self.sd.get("tts_engine","online")
        voice = CONFIG.get("tts",{}).get("online_voice","en-US-AriaNeural")
        mp = get_voice_path(self.sd)
        self._tw = TTSWorker(text, eng, voice, mp, emotion=emotion)
        self._tw.done.connect(play_audio)
        self._tw.done.connect(self._on_tts_done)
        if self.sd.get("lip_sync_tts", True):
            self._tw.done.connect(lambda _: self._lip_sync_start())
        self._tw.failed.connect(lambda _: self._lip_sync_stop())
        self._tw.failed.connect(lambda e: print(f"[TTS] {e.split(chr(10))[0][:120]}"))
        self._tw.start()

    def _toggle_mc(self):
        # Check button state — if showing ✖ we are connected/connecting, so stop
        if self.mc_btn.text() == "✖":
            self._mc_stop(); return
        # Warn if localhost
        mc = CONFIG.get("minecraft", {})
        if not mc.get("host") or mc.get("host") == "localhost":
            from PyQt6.QtWidgets import QMessageBox
            mb = QMessageBox(self)
            mb.setWindowTitle("Minecraft")
            mb.setText("Server is set to localhost.\nMake sure your local server is running!")
            mb.setStandardButtons(QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
            mb.setWindowFlags(mb.windowFlags() | Qt.WindowType.WindowStaysOnTopHint)
            if mb.exec() != QMessageBox.StandardButton.Yes: return
        self._mc_start()

    def _mc_start(self):
        from core.config import BASE, CONFIG_PATH
        self._start_mc_spinner()   # show connecting indicator
        mc = CONFIG.get("minecraft", {})
        host     = mc.get("host",     "localhost")
        port     = str(mc.get("port", 25565))
        username = mc.get("username", "RavenBot")
        version  = mc.get("version",  "1.21")
        ws_port  = str(mc.get("ws_port", 8765))
        auth     = mc.get("auth",     "offline")

        bot_js = BASE / "drone" / "bot.js"
        if not bot_js.exists():
            self._display("*confused* bot.js not found in the drone vault! [EMOTION: confused] 📁")
            return

        # Check node is available
        import shutil
        if not shutil.which("node"):
            self._display("*error* Node.js not found. Install from nodejs.org! [EMOTION: shocked] 💻")
            return

        cmd = [
            "node", str(bot_js),
            "--host",     host,
            "--port",     port,
            "--username", username,
            "--version",  version,
            "--ws_port",  ws_port,
            "--auth",     auth,
        ]
        try:
            self._mc_proc = subprocess.Popen(
                cmd,
                cwd        = str(BASE / "drone"),
                stdout     = subprocess.PIPE,
                stderr     = subprocess.STDOUT,
                text       = True,
                bufsize    = 1,
            )
            # Update button appearance
            self.mc_btn.setProperty("connected", True)
            self.mc_btn.setStyleSheet(
                f"QPushButton{{background:rgba(74,222,128,0.3);border:1px solid #4ade80;"
                f"border-radius:5px;font-size:13px;color:#4ade80}}"
                f"QPushButton:hover{{background:rgba(255,107,157,0.2);border-color:{PINK}}}"
            )
            self.mc_btn.setToolTip(f"Disconnect from {host}:{port}")
            self.mc_btn.setText("✖")

            # Start a thread to read bot.js stdout into the MC console
            import threading
            def _read():
                for line in self._mc_proc.stdout:
                    clean = line.rstrip()
                    print(f"[BOT.JS] {clean}")
                    col = "#4ade80" if "✓" in clean or "Spawned" in clean else \
                          "#ff4444" if "Error" in clean or "error" in clean else \
                          "#fbbf24" if "Connecting" in clean else TXT2
                    QTimer.singleShot(0, lambda l=clean, c=col: self._mc_console_log(l, c))
                # Process ended — reset UI from main thread
                QTimer.singleShot(0, self._mc_auto_stop)
            threading.Thread(target=_read, daemon=True, name="bot_stdout").start()

            # Start mc_brain listener — callbacks go through the bridge so Qt
            # widgets are only touched from the main thread
            try:
                from core.mc_brain import MCBrain
                bridge = self._mc_bridge
                self._mc_brain = MCBrain(
                    on_cmd     = lambda cmd, args={}: bridge.sig_cmd.emit(cmd, args),
                    on_emotion = lambda emo:          bridge.sig_emotion.emit(emo),
                    on_chat    = lambda msg:          bridge.sig_chat.emit(msg),
                    on_task    = lambda label, active: bridge.sig_task.emit(label, active),
                    on_radar   = lambda ents:         bridge.sig_radar.emit(ents),
                    save_data  = self.sd,
                    task_queue = self.task_queue, # ── CONNECTED THE SYNAPSE
                )
                _ws = f"ws://localhost:{ws_port}"
                QTimer.singleShot(1500, lambda: self._mc_brain and self._mc_brain.start_listening(_ws))
            except ImportError:
                print("[MC] mc_brain.py not found — running bot only")

            self._display(
                f"*boots up* Joining {host}:{port} as {username}~ [EMOTION: excited] ⛏️"
            )
            play_sfx("notify.wav")
            self._stop_mc_spinner()   # connected — hide spinner
            # Show MC control bar
            if hasattr(self, '_mc_bar'):
                self._mc_bar.setVisible(True)
                self._update_mc_bar_style()
            self._enter_mc_input_mode()

        except Exception as e:
            self._stop_mc_spinner()
            self._display(f"*error* Could not launch bot: {e} [EMOTION: shocked] 💥")

    def _mc_stop(self):
        if self._mc_proc:
            try: self._mc_proc.terminate()
            except Exception: pass
            self._mc_proc = None

        if hasattr(self, '_mc_brain') and self._mc_brain:
            try: self._mc_brain.stop()
            except Exception: pass
            self._mc_brain = None

        self.mc_btn.setProperty("connected", False)
        self.mc_btn.setStyleSheet(
            f"QPushButton{{background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.3);"
            f"border-radius:5px;font-size:13px;color:#4ade80}}"
            f"QPushButton:hover{{background:rgba(74,222,128,0.25)}}"
        )
        self.mc_btn.setText("⛏")
        self.mc_btn.setToolTip("Join Minecraft Server")
        self._stop_mc_spinner()
        if hasattr(self, '_mc_bar'): self._mc_bar.setVisible(False)
        self._mc_update_task_bar()
        self._exit_mc_input_mode()
        self._display("*disconnects* Logging out of the server~ [EMOTION: sleepy] 🌙")

    def _mc_send_cmd(self, cmd: str, args: dict = {}):
        """Send a command to drone.bot.js via mc_brain."""
        if hasattr(self, '_mc_brain') and self._mc_brain:
            self._mc_brain.send_cmd(cmd, args)

    # ── MC mode helpers ───────────────────────────────────────────────────────
    def _set_mc_mode(self, mode: str):
        """Switch follower/task mode from the GUI bar."""
        self._mc_mode = mode
        self._update_mc_bar_style()
        # Send to bot
        self._mc_send_cmd("set_mode", {"mode": mode})
        label = "👁 Follower mode — I'll watch over you~" if mode == "follower" \
                else "⚒ Task mode — ready for orders!"
        self._display(f"*recalibrating* {label} [EMOTION: thinking] ⛏️")

    def _send_mc_percent(self):
        """Send whatever is in the % command input to the bot."""
        if not hasattr(self, '_mc_cmd_inp'): return
        text = self._mc_cmd_inp.text().strip()
        if not text: return
        if not text.startswith('%'): text = '%' + text
        self._mc_cmd_inp.clear()
        # Route through mc_brain as a raw text command
        if hasattr(self, '_mc_brain') and self._mc_brain:
            self._mc_brain.send_cmd("text", {"text": text})
        self._display(f"*sent* `{text}` [EMOTION: thinking]")

    def _mc_auto_stop(self):
        """Called automatically when drone.bot.js process exits."""
        if self.mc_btn.text() != "⛏":
            self._mc_proc = None; self._mc_brain = None
            self.mc_btn.setText("⛏"); self.mc_btn.setToolTip("Join Minecraft Server")
            self.mc_btn.setStyleSheet(
                f"QPushButton{{background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.3);"
                f"border-radius:5px;font-size:13px;color:#4ade80}}"
                f"QPushButton:hover{{background:rgba(74,222,128,0.25)}}"
            )
            self._stop_mc_spinner()
            if hasattr(self, '_mc_bar'): self._mc_bar.setVisible(False)
            self._mc_update_task_bar()
            self._exit_mc_input_mode()

    def _enter_mc_input_mode(self):
        """Switch to console tab when MC connects."""
        if hasattr(self, '_tab_con_btn'):
            self._switch_bottom_tab(1)

    def _exit_mc_input_mode(self):
        """Switch back to chat tab when MC disconnects."""
        if hasattr(self, '_tab_chat_btn'):
            self._switch_bottom_tab(0)

    def _mc_parse_inv_stats(self, txt: str):
        """Legacy text-based parser — kept for compatibility but no longer called
        for inventory/status (those now arrive via sig_inv / sig_status).
        Still used for any other chat-routed messages that mention inventory keywords."""
        pass   # inventory and status are fully handled via dedicated signals now

    def _mc_update_inv_panel(self, items: list):
        """Called by sig_inv — NEVER touches update_chat_log or trigger_tts.
        Updates BOTH the always-visible main-panel Inventory tab AND the
        MC Settings dialog panel when it is open.
        Each panel is guarded with try/except so a closed dialog's dead
        C++ wrapper never causes a RuntimeError crash."""
        ICONS = {
            'diamond': '💎', 'netherite': '⚫', 'gold': '🟡', 'iron': '⚙️',
            'coal': '🪨',    'sword': '⚔️',    'pickaxe': '⛏',  'axe': '🪓',
            'bow': '🏹',     'arrow': '➡️',    'torch': '🕯',   'stone': '🪨',
            'log': '🪵',     'plank': '🪵',    'chest': '📦',   'totem': '🏺',
            'helmet': '⛑️',  'chestplate': '🛡','leggings': '👖','boots': '👟',
            'shield': '🛡',  'armor': '🛡',    'bread': '🍞',   'apple': '🍎',
            'cooked': '🍗',  'food': '🍖',     'bucket': '🪣',  'rod': '🎣',
        }
        def _fill(lw):
            lw.clear()
            if not items:
                lw.addItem(QListWidgetItem("(inventory is empty)")); return
            for entry in items:
                name  = entry.get('name', '?')
                count = entry.get('count', 1)
                icon  = '▪️'
                for kw, ic in ICONS.items():
                    if kw in name: icon = ic; break
                lw.addItem(QListWidgetItem(f"{icon}  {name.replace('_', ' ')}  ×{count}"))

        # ── Main panel (always alive — safe to call any time) ──────────────
        if hasattr(self, '_main_inv_list'):
            try: _fill(self._main_inv_list)
            except RuntimeError: pass

        # ── MC Settings dialog panel (only alive while the dialog is open) ─
        if hasattr(self, '_mc_inv_list'):
            try: _fill(self._mc_inv_list)
            except RuntimeError: pass   # dialog closed — C++ object deleted

    def _mc_update_status_panel(self, data: dict):
        """Called by sig_status — NEVER touches update_chat_log or trigger_tts.
        Updates BOTH the always-visible main-panel stats label AND the
        MC Settings dialog stats label when it is open.
        XP is stripped (intentionally omitted per spec)."""
        hp   = data.get('hp',   '?')
        food = data.get('food', '?')
        x    = data.get('x',    '?')
        y    = data.get('y',    '?')
        z    = data.get('z',    '?')
        held = data.get('held', 'empty')
        txt  = f"❤️ HP: {hp}/20  |  🍖 Food: {food}/20  |  📍 {x} {y} {z}  |  🛡 {held}"

        # ── Main panel (always alive) ──────────────────────────────────────
        if hasattr(self, '_main_stats_lbl'):
            try: self._main_stats_lbl.setText(txt)
            except RuntimeError: pass

        # ── MC Settings dialog label (only alive while the dialog is open) ─
        if hasattr(self, '_mc_stats_lbl'):
            try: self._mc_stats_lbl.setText(txt)
            except RuntimeError: pass   # dialog closed — C++ object deleted

    def _mc_update_task_bar(self, label: str = "", active: bool = False):
        """Update the active-task strip below the MC bar."""
        if not hasattr(self, '_mc_task_bar'): return
        if active and label:
            self._mc_task_lbl.setText(label[:80])
            self._mc_task_bar.setVisible(True)
        else:
            self._mc_task_bar.setVisible(False)

    def _mc_update_task_list_widget(self, label: str = "", active: bool = False):
        """Update the task queue list with per-task ✕ stop buttons."""
        if not hasattr(self, '_task_queue_list_widget'): return
        try:
            lw = self._task_queue_list_widget
            lw.clear()
            if active and label:
                lines = [l.strip() for l in label.split(" | ") if l.strip()]
                for line in lines:
                    item = QListWidgetItem()
                    lw.addItem(item)
                    row_w = QWidget()
                    row_lay = QHBoxLayout(row_w)
                    row_lay.setContentsMargins(4, 1, 4, 1); row_lay.setSpacing(4)
                    is_active = line.startswith("▶")
                    color = "#4ade80" if is_active else "#fbbf24"
                    lbl_w = QLabel(line)
                    lbl_w.setStyleSheet(f"color:{color};font-size:11px;background:transparent")
                    lbl_w.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
                    row_lay.addWidget(lbl_w, 1)
                    # Per-task ✕ button — sends %stop
                    x_btn = QPushButton("✕")
                    x_btn.setFixedSize(18, 18)
                    x_btn.setStyleSheet(
                        "QPushButton{background:#cc3333;border:none;border-radius:4px;"
                        "color:white;font-size:10px;font-weight:bold}"
                        "QPushButton:hover{background:#ff4444}"
                    )
                    x_btn.clicked.connect(lambda: self._send_mc_percent_text("%stop"))
                    row_lay.addWidget(x_btn)
                    row_w.setFixedHeight(22)
                    item.setSizeHint(row_w.sizeHint())
                    lw.setItemWidget(item, row_w)
            else:
                # Show placeholder item
                item = QListWidgetItem("No active tasks — queue something below")
                item.setForeground(__import__('PyQt6.QtGui', fromlist=['QColor']).QColor(_c('TXT2')))
                lw.addItem(item)
        except Exception: pass

    def _toggle_radar(self, checked: bool):
        """Show/hide the portrait radar overlay (mc_bar button)."""
        if hasattr(self, "_radar_overlay"):
            self._radar_overlay.setVisible(checked)

    def _radar_panel_toggle(self, checked: bool):
        """Start/stop radar updates in the main-panel radar tab."""
        if hasattr(self, "_radar_main"):
            self._radar_main.set_active(checked)
            self._radar_main.update()
        if hasattr(self, "_rdr_toggle_btn"):
            self._rdr_toggle_btn.setText("⏹ Stop" if checked else "▶ Start")

    # ── Lip-sync helpers ──────────────────────────────────────────────────────
    def _lip_sync_start(self):
        """Called when TTS audio file is ready.
        Kick off the Thinking→Neutral→[Talking↔Neutral...]→TargetEmotion state machine."""
        self._lip_sync_frame = False
        self._lip_sync_timer.start()
        self._lip_sync_poll.start()

    def _lip_sync_stop(self):
        """Audio finished — stop animation and land on the target emotion."""
        self._lip_sync_timer.stop()
        self._lip_sync_poll.stop()
        self._lip_sync_frame = False
        # Restore the actual target emotion now that speaking is done
        target = getattr(self, "_tq_emo", self.emo)
        self._set_emo(target)

    def _lip_sync_tick(self):
        """Toggle between 'talking' and 'neutral' every 150 ms while TTS audio plays.
        The target emotion is only applied once the audio finishes (in _lip_sync_stop)."""
        self._lip_sync_frame = not self._lip_sync_frame
        if self._lip_sync_frame:
            self._set_emo("talking")   # mouth open
        else:
            self._set_emo("neutral")   # mouth closed — always neutral, never target yet

    def _lip_sync_check_done(self):
        """Poll pygame mixer to detect when audio playback finishes."""
        try:
            import pygame
            if not pygame.mixer.music.get_busy():
                self._lip_sync_stop()
        except Exception:
            self._lip_sync_stop()

    def _load_face_img(self, emo: str, fallback: str = "neutral"):
        """Load a face image by emotion name; fall back if file missing."""
        from gui.graphics import scan_outfits
        fc = _OUTFITS_CACHE or scan_outfits()
        prefix = CONFIG.get("outfits", {}).get(
            self.sd.get("outfit", "Base"), ""
        )
        key = f"{prefix}{emo}" if prefix else emo
        path = fc.get(key)
        if not path:
            # No talking sprite — just slightly brighten current face
            return
        from PyQt6.QtGui import QPixmap
        pix = QPixmap(path)
        if not pix.isNull():
            pix = pix.scaled(380, 330,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation)
            self.pet_img.setPixmap(pix)

    def _update_mc_bar_style(self):
        """Keep mode buttons visually in sync."""
        if not hasattr(self, '_mc_btn_follow'): return
        self._mc_btn_follow.setChecked(self._mc_mode == "follower")
        self._mc_btn_task.setChecked(self._mc_mode == "task")

    def _mc_console_log(self, line: str, color: str = None):
        """Append a line to the MC console buffer, live dialog view, and main console panel."""
        if not hasattr(self, '_mc_console_buf'):
            self._mc_console_buf = []
        c = color or TXT2
        self._mc_console_buf.append((line, c))
        if len(self._mc_console_buf) > 400:
            self._mc_console_buf = self._mc_console_buf[-300:]

        # Write to dialog console if open
        live = getattr(self, '_mc_console_live', None)
        if live:
            try: live(line, c)
            except Exception: pass

        # Write to always-visible main console panel
        if hasattr(self, '_main_con_log'):
            try:
                self._main_con_log.append(f'<span style="color:{c};">{line}</span>')
                self._main_con_log.verticalScrollBar().setValue(
                    self._main_con_log.verticalScrollBar().maximum()
                )
            except Exception: pass

    def _send_mc_percent_text(self, text: str):
        if not text.startswith('%'): text = '%' + text
        
        # ── Route through the Motor Cortex ──
        if hasattr(self, 'task_queue'):
            task = parse_task(text[1:], default_username=self.sd.get("user_name", "User"))
            if task:
                self.task_queue.enqueue(task)
                return

        # Fallback for unparsed commands
        if hasattr(self, '_mc_brain') and self._mc_brain:
            self._mc_brain.send_cmd("text", {"text": text})
        else:
            self._mc_console_log("⚠ Bot not connected", color="#ff9800")

    # ── MC connection spinner ─────────────────────────────────────────────────
    _SPIN_FRAMES = ["◐","◓","◑","◒"]

    def _start_mc_spinner(self):
        """Show rotating arc in topbar while connecting."""
        if not hasattr(self, 'mc_spinner'): return
        self._mc_spin_frame = 0
        self.mc_spinner.setVisible(True)
        if self._mc_spin_timer is None:
            self._mc_spin_timer = QTimer(self)
            self._mc_spin_timer.setInterval(120)
            self._mc_spin_timer.timeout.connect(self._tick_mc_spinner)
        self._mc_spin_timer.start()

    def _stop_mc_spinner(self):
        """Hide the spinner."""
        if self._mc_spin_timer: self._mc_spin_timer.stop()
        if hasattr(self, 'mc_spinner'): self.mc_spinner.setVisible(False)

    def _tick_mc_spinner(self):
        self._mc_spin_frame = (self._mc_spin_frame + 1) % len(self._SPIN_FRAMES)
        if hasattr(self, 'mc_spinner'):
            self.mc_spinner.setText(self._SPIN_FRAMES[self._mc_spin_frame])

    # ── Mic / STT ─────────────────────────────────────────────────────────────
    def _on_tts_done(self, path: str):
        """Called when TTS audio file is ready. Store path for replay button."""
        self._last_tts_path = path
        if hasattr(self, '_replay_btn'):
            self._replay_btn.setVisible(True)

    def _replay_tts(self):
        """Replay the last TTS audio file."""
        path = getattr(self, '_last_tts_path', None)
        if path:
            stop_audio()
            play_audio(path)

    def _toggle_mic(self):
        if not _STT_AVAILABLE or not STTWorker:
            self._display("*confused* STT not available. Run: pip install sounddevice [EMOTION: confused] 🎤")
            return
        # Strict state lock — ignore clicks while stream is spinning up or tearing down
        if getattr(self, '_mic_transitioning', False):
            return
        if not self._recording:
            self._start_recording()
        else:
            self._stop_recording()

    def _start_recording(self):
        self._mic_transitioning = True
        self._recording = True
        self.mic_btn.setProperty("recording", True)
        self.mic_btn.setStyleSheet(
            f"QPushButton#micBtn{{background:#ff4444;border:2px solid #ff6666;"
            f"border-radius:10px;font-size:18px;min-width:42px;min-height:42px}}"
        )
        self.mic_btn.setText("⏹")
        self.mic_btn.setToolTip("Click to stop recording")
        self.bubble.setText(f'<span style="color:#ff4444;font-weight:bold;">🔴 Recording... click ⏹ to stop</span>')
        self._stt = STTWorker(self)
        self._stt.result.connect(self._on_stt_result)
        self._stt.failed.connect(self._on_stt_fail)
        self._stt.started_recording.connect(lambda: (
            setattr(self, '_mic_transitioning', False),
            print("[STT] Mic open"),
            self._start_vu_main()
        ))
        self._stt.stopped_recording.connect(lambda: self.bubble.setText(
            f'<span style="color:{CYAN};font-style:italic;">*processing speech...*</span>'
        ))
        self._stt.start()

    def _stop_recording(self):
        self._mic_transitioning = True
        self._recording = False
        self._stop_vu_main()
        self.mic_btn.setStyleSheet(
            f"QPushButton#micBtn{{background:{BG3};border:1px solid rgba(192,132,252,0.3);"
            f"border-radius:10px;font-size:18px;min-width:42px;min-height:42px}}"
            f"QPushButton#micBtn:hover{{border-color:{PINK}}}"
        )
        self.mic_btn.setText("🎤")
        self.mic_btn.setToolTip("Click to speak (STT)")
        if self._stt:
            self._stt.stop_recording()

    def _on_stt_result(self, text: str):
        print(f"[STT] Transcribed: {text}")
        self.inp.setText(text)
        self._recording = False
        self._mic_transitioning = False
        self.mic_btn.setText("🎤")
        self._stop_vu_main()
        # Auto-send after a short delay so user can see what was recognised
        QTimer.singleShot(600, self._send)

    def _on_stt_fail(self, err: str):
        print(f"[STT] Error: {err}")
        self._recording = False
        self._mic_transitioning = False
        self.mic_btn.setText("🎤")
        self._stop_vu_main()
        self._display(f"*taps ear* I couldn't hear that... ({err}) [EMOTION: confused] 🎤")

    # ── Main-window VU meter helpers ──────────────────────────────────────────
    def _start_vu_main(self):
        """Show the mini VU bar and start polling the recorder's live peak."""
        if hasattr(self, '_vu_wrap'): self._vu_wrap.setVisible(True)
        self._vu_level_main = 0.0
        self._vu_timer_main = QTimer(self)
        self._vu_timer_main.setInterval(40)   # 25 fps
        self._vu_timer_main.timeout.connect(self._tick_vu_main)
        self._vu_timer_main.start()

    def _stop_vu_main(self):
        """Hide the VU bar and kill the timer."""
        if self._vu_timer_main:
            self._vu_timer_main.stop()
            self._vu_timer_main = None
        if hasattr(self, '_vu_wrap'): self._vu_wrap.setVisible(False)
        # reset all segments to off
        for _, seg in self._vu_main_segs:
            seg.setStyleSheet(f"background:{seg._off};border-radius:1px")

    def _tick_vu_main(self):
        """Read the live peak from the STT recorder and update the bar."""
        import math
        peak = 0.0
        if self._stt and hasattr(self._stt, 'recorder'):
            peak = getattr(self._stt.recorder, '_latest_peak', 0.0)
            self._stt.recorder._latest_peak = 0.0
        # Log scaling so quiet speech still fills half the bar
        if peak > 0:
            scaled = math.log2(1.0 + peak * 15.0) / math.log2(16.0)
        else:
            scaled = 0.0
        if not hasattr(self, '_vu_level_main'): self._vu_level_main = 0.0
        self._vu_level_main = max(scaled, self._vu_level_main * 0.72)
        lit = int(self._vu_level_main * len(self._vu_main_segs))
        for idx, seg in self._vu_main_segs:
            on = idx < lit
            seg.setStyleSheet(
                f"background:{seg._on if on else seg._off};border-radius:1px"
            )

    # ── Send message ──────────────────────────────────────────────────────────
    def _send(self):
        text = self.inp.text().strip()
        if not text or self.busy: return
        if self._chk_cheat(text): self.inp.clear(); return
        # ── Lazy compression: first message of new session ────────────────────
        # If there's raw history from last session, compress it NOW before
        # sending — hidden inside the normal "thinking" spinner.
        if MEM.has_pending_history(self.sd) and not self._compressing:
            self._compressing = True
            raw = MEM.pop_raw_history(self.sd)
            # NOTE: do NOT persist_save here — raw_history stays on disk until
            # compression succeeds. If the API call fails, raw survives the crash.
            def _on_compress_done(summary):
                self._compressing = False
                persist_save(self.sd)   # only wipe raw_history AFTER success
                print(f"[MEM] Session compressed: {summary[:80]}...")
            def _on_compress_fail(err):
                self._compressing = False
                # Restore raw_history so it's retried next session
                MEM.restore_raw_history(self.sd, raw)
                print(f"[MEM] Compression failed (history preserved): {err}")
            MEM.compress_session_async(
                sd       = self.sd,
                raw      = raw,
                pet_name = self.sd.get("pet_name","Companion"),
                user_name= self.sd.get("user_name","User"),
                on_done  = _on_compress_done,
                on_fail  = _on_compress_fail,
            )
        # ─────────────────────────────────────────────────────────────────────

        self.busy = True; self.inp.clear()
        self.sbtn.setEnabled(False); self.inp.setEnabled(False); self.lbar.show()
        self.bubble.setText(f'<span style="color:{CYAN};font-style:italic;">*thinking...*</span>')
        self._set_emo("thinking"); self._add_hist("user", text)
        bm = self.sd.get("brain_mode", "local")
        if bm == "offline":
            r = self._fallback(text); self._add_hist("assistant", r); self._display(r); self._fin(); return
        if bm == "online":
            url, key, mdl = (CONFIG.get("online_api_url",""),
                              CONFIG.get("online_api_key",""),
                              CONFIG.get("online_api_model",""))
            if not key or key == "YOUR-API-KEY-HERE":
                self._display("*checks wallet* Set your API key in config.json! [EMOTION: confused] 🔑")
                self._fin(); return
        else:
            url  = CONFIG.get("local_api_url", "http://localhost:1234/v1/chat/completions")
            key  = CONFIG.get("local_api_key", "")
            mdl  = CONFIG.get("local_api_model", "local-model")
        self._aw = AIWorker(self._build_msgs(), url, key, mdl, self)
        self._aw.finished.connect(self._on_reply)
        self._aw.error.connect(self._on_err)
        self._aw.start()

    def _on_reply(self, r: str):
        self._add_hist("assistant", r)
        # Save last response + emotion immediately — survives any crash after this
        clean, emo = self._preview_extract(r)
        self.sd["last_response"] = clean[:400]
        self.sd["last_emotion"]  = emo
        self._last_msg           = clean
        persist_save(self.sd)  # <-- write to disk right now
        # Dedup traits every 10 replies; compress when they pile up
        if len(self.hist) % 10 == 0 and self.traits:
            self.traits = dedup_traits(self.traits)
            save_traits(self.traits)
            if MEM.needs_trait_compression(self.traits):
                def _on_compressed(new_traits):
                    self.traits = new_traits
                    save_traits(self.traits)
                    print(f"[MEM] Traits auto-compressed to {len(new_traits)}")
                MEM.compress_traits_async(self.traits, self.sd, on_done=_on_compressed)
        self._display(r); self._fin()

    def _preview_extract(self, text: str) -> tuple:
        clean = re.sub(r"\[STAT:[^\]]+\]",    "", text, flags=re.I)
        clean = re.sub(r"\[TRAIT:[^\]]+\]",   "", clean, flags=re.I)
        emo   = "neutral"
        m = re.search(r"\[EMOTION:\s*(\w+)\]", text, re.I)
        if m: emo = m.group(1).lower()
        clean = re.sub(r"\[EMOTION:[^\]]+\]", "", clean, flags=re.I)
        return clean.strip(), emo

    def _on_err(self, e: str):
        print(f"[AI] Error: {e}")
        bm = self.sd.get("brain_mode", "local")
        r = random.choice(_DEAD_MSGS) if bm == "local" else \
            "*confused* Online API error... check your key/URL! [EMOTION: confused] 🔑"
        play_sfx("error.wav")
        self._add_hist("assistant", r); self._display(r); self._fin()

    def _fin(self):
        self.busy = False; self.sbtn.setEnabled(True)
        self.inp.setEnabled(True); self.lbar.hide(); self.inp.setFocus()

    # ── Offline fallback responses ────────────────────────────────────────────
    def _fallback(self, ui: str) -> str:
        n, lo = self.sd["user_name"], ui.lower()
        if re.search(r"\b(hi|hello|hey)\b", lo):   return f"Hey {n}! What's up? [EMOTION: happy] 😊"
        if re.search(r"\b(sad|depressed|tired)\b", lo): return f"*hugs* I'm here for you, {n}. [EMOTION: sad] [STAT: loyalty +2] 😔"
        if re.search(r"\b(cute|love|beautiful)\b", lo): return f"S-stop that...! [EMOTION: blush] [STAT: affection +3] 😳"
        if re.search(r"\b(stupid|dumb|hate)\b", lo):    return f"Wow, rude much? [EMOTION: annoyed] [STAT: sass +2] 😒"
        if re.search(r"\b(bored|boring)\b", lo):        return f"Same tbh. *yawns* [EMOTION: bored] 😑"
        if re.search(r"\b(food|eat|hungry)\b", lo):     return f"*perks up* FOOD?! Where?! [EMOTION: excited] 😋"
        if re.search(r"\b(sleep|night|gn)\b", lo):      return f"Goodnight~ Sweet dreams! [EMOTION: sleepy] 😴"
        return random.choice([
            f"That's interesting, {n}~ [EMOTION: thinking] 🤔",
            f"Oh? Tell me more! [EMOTION: excited] ✨",
            f"*nods* Mmhmm, go on~ [EMOTION: smirk] 😏",
            f"Heh, you're something else. [EMOTION: happy] 😊",
            f"*stares* ...what? [EMOTION: confused] 🤔",
            f"Meh. I've heard better. [EMOTION: bored] 😑",
            f"PFFT- okay that got me [EMOTION: happy] 😂",
        ])

    # ── Cheat codes ───────────────────────────────────────────────────────────
    def _chk_cheat(self, t: str) -> bool:
        from gui.graphics import ALL_EMOTIONS
        lo = t.lower().strip()
        m = re.match(r"^force(\w+)$", lo)
        if m:
            emo = m.group(1)
            # Accept any known emotion including talking and fullbody
            if emo in ALL_EMOTIONS or emo in CONFIG.get("emotions", []):
                self._set_emo(emo); return True
        if lo == "showmehearts":
            self.hvis = not self.hvis; self.sd["hearts_visible"] = self.hvis
            self._upd_hearts(); persist_save(self.sd); return True
        if lo in ("rosebud", "motherlode"):
            self.sd["stats"]["affection"] = 100; self._upd_hearts(); persist_save(self.sd)
            self._display("*sparkles* MAX LOVE~ [EMOTION: love] 💖"); return True
        if lo == "iddqd":
            for k in self.sd["stats"]: self.sd["stats"][k] = 100
            self._upd_hearts(); persist_save(self.sd)
            self._display("*POWER OVERWHELMING* [EMOTION: excited] ⚡"); return True
        if lo == "upupdowndown":
            self.sd["persona"] = "Girlfriend"; persist_save(self.sd)
            self._display("*transforms* I'm your girlfriend now~ [EMOTION: love] 💕"); return True
        if lo == "amnesia":
            self.hist.clear(); self._upd_mem()
            self._display("*blinks* Huh? What were we talking about? [EMOTION: confused] 😵"); return True
        return False

    # ── Right-click context menu ──────────────────────────────────────────────
    def _ctx(self, pos):
        menu = _RoundMenu(self); menu.setStyleSheet(TH.build_stylesheet())
        fc = _OUTFITS_CACHE or scan_outfits()

        def _rsub(parent_menu, title):
            """Create a sub-menu that also gets rounded-mask treatment."""
            sub = _RoundMenu(title, parent_menu)
            sub.setStyleSheet(TH.build_stylesheet())
            parent_menu.addMenu(sub)
            return sub

        # Outfits
        om = _rsub(menu, "👗 Change Outfit")
        for n in sorted(CONFIG["outfits"]):
            pf  = CONFIG["outfits"][n]
            cnt = sum(1 for e in CONFIG.get("emotions", []) if (f"{pf}{e}" if pf else e) in fc)
            ck  = "✅ " if n == self.outfit else ""
            a   = om.addAction(f"{ck}{n} ({cnt}/{len(CONFIG['emotions'])})"); a.setData(f"outfit|{n}")
        om.addSeparator()
        om.addAction("🔄 Rescan").setData("outfit|__rescan__")
        om.addAction("📋 Audit").setData("outfit|__audit__")

        # Personas (grouped)
        pm = _rsub(menu, "🎭 Change Persona")
        for gname, members in _PERSONA_GROUPS.items():
            gm = _rsub(pm, gname)
            for mn in members:
                if mn in CONFIG["personas"]:
                    ck = "✅ " if mn == self.sd["persona"] else ""
                    gm.addAction(f"{ck}{mn}").setData(f"persona|{mn}")

        # Interact
        im = _rsub(menu, "✨ Interact")
        for k, l in _INTERACT_MENU:
            im.addAction(l).setData(f"interact|{k}")
        menu.addSeparator()

        # Settings — single entry opens the unified settings dialog
        sm = _rsub(menu, "⚙️ Settings")
        sm.addAction("📊 Stats").setData("setting|view_stats")
        sm.addSeparator()
        sm.addAction("⚙️  All Settings").setData("setting|all_settings")
        sm.addAction("🎮 Minecraft Settings").setData("setting|mc_settings")
        sm.addAction("🎨 Theme / Colors").setData("setting|theme_picker")

        ch = menu.exec(self.mapToGlobal(pos))
        if ch and ch.data(): self._menu_act(ch.data())

    def _menu_act(self, data: str):
        k, _, v = data.partition("|")
        if k == "outfit":
            if v == "__rescan__":
                import graphics; graphics._cache_time=0; _fc2=scan_outfits(); globals().update({'_OUTFITS_CACHE':_fc2}); self._display(f"*scans* Found {len(_fc2)} files! [EMOTION: happy] 🔍")
            elif v == "__audit__": audit_outfits(); self._display("Audit in terminal! [EMOTION: thinking] 📋")
            else: self._set_outfit(v)
        elif k == "persona":
            self.sd["persona"] = v; persist_save(self.sd); play_sfx("outfit.wav")
            self._display(f"*shifts* I feel different~ [EMOTION: shocked] ✨")
        elif k == "brain":
            self.sd["brain_mode"] = v; persist_save(self.sd); self._upd_brain()
            self._display(f"*recalibrating* Brain: {_BRAIN_NAMES.get(v, v)} [EMOTION: thinking] 🧠")
        elif k == "interact":
            act = CONFIG.get("interactions", {}).get(v, f"*I {v} you.*")
            self.busy = True; self.lbar.show(); self._set_emo("thinking")
            self.bubble.setText(f'<span style="color:{CYAN};font-style:italic;">*processing...*</span>')
            self._add_hist("user", act)
            bm = self.sd.get("brain_mode", "local")
            if bm == "offline":
                r = self._fallback(act); self._add_hist("assistant", r); self._display(r); self._fin(); return
            url = CONFIG.get("online_api_url" if bm=="online" else "local_api_url","")
            key = CONFIG.get("online_api_key" if bm=="online" else "local_api_key","")
            mdl = CONFIG.get("online_api_model" if bm=="online" else "local_api_model","")
            self._aw = AIWorker(self._build_msgs(), url, key, mdl, self)
            self._aw.finished.connect(self._on_reply); self._aw.error.connect(self._on_err); self._aw.start()
        elif k == "voice":
            if v == "__rescan__": scan_piper_models(); self._display(f"Found {len(PIPER_MODELS)} voices! [EMOTION: happy] 🎤")
            elif v in PIPER_MODELS:
                self.sd["selected_offline_voice"] = v; persist_save(self.sd)
                self._display(f"*clears throat* New voice: {v} [EMOTION: happy] 🎤")
                if not self.sd.get("tts_enabled"):
                    self.sd["tts_enabled"] = True; self.sd["tts_engine"] = "offline"; persist_save(self.sd)
        elif k == "setting": self._setting(v)

    def _setting(self, v: str):
        if   v == "theme_picker":   self._theme_picker_dlg()
        elif v == "all_settings":   self._all_settings_dlg()
        elif v == "tts_settings":   self._tts_settings_dlg()
        elif v == "ai_settings":    self._ai_settings_dlg()
        elif v == "el_settings":    self._el_settings_dlg()
        elif v == "mc_settings":    self._mc_settings_dlg()
        elif v == "msg_limit":      self._msg_limit_dlg()
        elif v == "view_stats":     self._stats_dlg()
        elif v == "view_memory":    self._mem_dlg()
        elif v == "wipe_memory":
            self.hist.clear(); self.traits.clear(); save_traits(self.traits); self._upd_mem()
            self._display("*blinks* Everything feels fresh~ [EMOTION: confused] 😵")
        elif v == "toggle_hearts":
            self.hvis = not self.hvis; self.sd["hearts_visible"] = self.hvis; self._upd_hearts(); persist_save(self.sd)
        elif v == "redo_setup":
            self.sd["setup_complete"] = False; self.sd["setup_answers"] = {}
            self.traits.clear(); save_traits(self.traits); persist_save(self.sd)
            self.sstep = 0; self.s_btn.show(); self.s_in.show()
            self.stack.setCurrentIndex(0); self._show_sq()
        elif v == "reset":
            mb = QMessageBox(self)
            mb.setWindowTitle("Reset")
            mb.setText("Factory reset ALL data?")
            mb.setStandardButtons(QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
            mb.setWindowFlags(mb.windowFlags() | Qt.WindowType.WindowStaysOnTopHint)
            if mb.exec() == QMessageBox.StandardButton.Yes:
                from core.config import SAVE_PATH, TRAITS_PATH
                for f in [SAVE_PATH, TRAITS_PATH]:
                    if f.exists(): f.unlink()
                self.sd = dict(DEFAULT_SAVE); self.traits = []; self.hist = []
                persist_save(self.sd); self.sstep = 0; self.s_btn.show(); self.s_in.show()
                self.stack.setCurrentIndex(0); self._show_sq()

    # ── Stats dialog ──────────────────────────────────────────────────────────
    def _stats_dlg(self):
        from PyQt6.QtWidgets import QProgressBar as PB
        th = TH._active
        b1=th["BG1"]; b3=th["BG3"]; bd=th["BORDER"]
        a1=th["ACC1"]; a2=th["ACC2"]; a3=th["ACC3"]
        tx1=th["TXT1"]; tx2=th["TXT2"]

        dlg = self._dlg_base("📊 Stats", w=400)
        lay = QVBoxLayout(dlg._content)
        hdr = QLabel("📊  Stats")
        hdr.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hdr.setStyleSheet(f"font-size:16px;font-weight:bold;color:{a3};padding:8px 0")
        lay.addWidget(hdr)

        for sn, sv in self.sd["stats"].items():
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
                    self.sd["stats"][stat] = max(0, min(100, self.sd["stats"][stat] + delta))
                    nv = self.sd["stats"][stat]; b.setValue(nv); vl.setText(str(nv))
                    th2 = TH._active
                    nc = th2["ACC2"] if nv > 70 else th2["ACC1"] if nv > 40 else "#e74c3c"
                    b.setStyleSheet(f"QProgressBar{{background:{th2['BG3']};border:none;border-radius:5px}}QProgressBar::chunk{{background:{nc};border-radius:5px}}")
                    persist_save(self.sd); self._upd_hearts()
                    play_sfx("stat_up.wav" if delta > 0 else "stat_down.wav")
                return cb
            minus.clicked.connect(_cb(sn, -5, bar, vlbl))
            plus.clicked.connect(_cb(sn,  5, bar, vlbl))
            lay.addLayout(row)
        self._save_btn(dlg, lay, dlg.accept)
        dlg.show()

    # ── Unified Settings dialog ────────────────────────────────────────────────
    def _all_settings_dlg(self):
        """Unified settings: General / Memory / AI+API / TTS / STT.
        Theme selection lives ONLY in the right-click context menu."""
        t  = TH._active
        dlg = self._dlg_base("⚙️  Settings", w=560)
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
        user_inp = QLineEdit(self.sd.get("user_name", "User"))
        user_inp.setStyleSheet(INP_SS)
        gen_lay.addWidget(_row("Your Name:", user_inp))

        # Pet name
        pet_inp = QLineEdit(self.sd.get("pet_name", "Companion"))
        pet_inp.setStyleSheet(INP_SS)
        gen_lay.addWidget(_row("Companion Name:", pet_inp))

        _sec(gen_lay, "🧠  Brain Mode")
        _gen_bm = [self.sd.get("brain_mode", "local")]   # mutable so closures can write it
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
        chk_hearts.setChecked(self.sd.get("hearts_visible", True))
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
            self.sd["setup_complete"] = False; persist_save(self.sd)
            self.stack.setCurrentIndex(0); dlg.accept()
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
            r = QMessageBox.question(self, "Factory Reset", "Wipes ALL saved data. Continue?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
            if r == QMessageBox.StandardButton.Yes:
                self.sd.clear(); self.sd.update(DEFAULT_SAVE)
                self.hist.clear(); self.traits.clear()
                save_traits(self.traits); persist_save(self.sd)
                self._display("*reboots* I feel... new. [EMOTION: confused] 🔄")
                dlg.accept()
        btn_reset.clicked.connect(_reset)
        gen_lay.addWidget(btn_reset)
        gen_lay.addStretch()

        def _save_gen():
            self.sd["user_name"] = user_inp.text().strip() or "User"
            self.sd["pet_name"]  = pet_inp.text().strip()  or "Companion"
            # Brain mode — update topbar icon immediately
            self.sd["brain_mode"] = _gen_bm[0]
            self._upd_brain()
            self.hvis = chk_hearts.isChecked()
            self.sd["hearts_visible"] = self.hvis; self._upd_hearts()
            CONFIG["max_history"] = hist_spin.value()
            # Update top-bar name immediately
            if hasattr(self, "name_lbl"):
                self.name_lbl.setText(self.sd["pet_name"].upper())
            persist_save(self.sd)

        tabs.addTab(gen_w, "⚙️ General")

        # ═════════════════════════════════════════════════════════════════════
        # TAB 2 ── Memory
        # ═════════════════════════════════════════════════════════════════════
        mem_w = QWidget(); mem_lay = QVBoxLayout(mem_w)
        mem_lay.setContentsMargins(16, 14, 16, 14); mem_lay.setSpacing(6)

        _sec(mem_lay, "🧠  Long-Term Traits")
        mem_info = QLabel(f"Traits: {len(self.traits)}  |  History: {len(self.hist)} messages")
        mem_info.setStyleSheet(f"color:{t['TXT2']};font-size:11px")
        mem_lay.addWidget(mem_info)

        traits_view = QTextEdit()
        traits_view.setReadOnly(True); traits_view.setFixedHeight(100)
        traits_view.setStyleSheet(TEXTEDIT_SS)
        traits_view.setPlainText("\n".join(self.traits[:60]) if self.traits else "(no traits stored yet)")
        mem_lay.addWidget(traits_view)

        btn_wipe = QPushButton("🗑️  Wipe Traits & History")
        btn_wipe.setFixedHeight(30)
        btn_wipe.setStyleSheet(
            f"QPushButton{{background:{t['BG3']};border:1px solid {t['BORDER']};"
            f"border-radius:8px;color:{t['TXT1']};font-size:12px}}"
            f"QPushButton:hover{{background:#7f1d1d;color:#fca5a5}}"
        )
        def _wipe():
            self.hist.clear(); self.traits.clear()
            save_traits(self.traits); self._upd_mem()
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
        if self.hist:
            lines = []
            for msg in self.hist:
                role = "You" if msg["role"] == "user" else self.sd.get("pet_name", "Companion")
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
        o_key_w, o_key = self._eye_field("sk-...", CONFIG.get("online_api_key", ""))
        o_mdl  = QLineEdit(CONFIG.get("online_api_model", "")); o_mdl.setStyleSheet(INP_SS)
        ai_lay.addWidget(_row("URL:", o_url))
        ai_lay.addWidget(_row("API Key:", o_key_w))
        ai_lay.addWidget(_row("Model:", o_mdl))

        _sec(ai_lay, "🖥️  Local API  (LM Studio / Ollama)")
        l_url  = QLineEdit(CONFIG.get("local_api_url", "")); l_url.setStyleSheet(INP_SS)
        l_key_w, l_key = self._eye_field("(optional)", CONFIG.get("local_api_key", ""))
        l_mdl  = QLineEdit(CONFIG.get("local_api_model", "")); l_mdl.setStyleSheet(INP_SS)
        ai_lay.addWidget(_row("URL:", l_url))
        ai_lay.addWidget(_row("API Key:", l_key_w))
        ai_lay.addWidget(_row("Model:", l_mdl))

        _sec(ai_lay, "⛏️  Minecraft Brain API  (mc_brain.py)")
        mc_cfg = CONFIG.get("minecraft", {})
        mc_burl_inp = QLineEdit(mc_cfg.get("brain_url", "")); mc_burl_inp.setStyleSheet(INP_SS)
        mc_bkey_w, mc_bkey = self._eye_field("MC Brain API Key", mc_cfg.get("brain_key", ""))
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
            self._display("*reconfiguring* API settings saved! [EMOTION: happy] 💾")
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
        chk_tts_on.setChecked(self.sd.get("tts_enabled", False))
        chk_tts_on.setStyleSheet(CHKSS)
        tts_lay.addWidget(chk_tts_on)

        chk_ls_tts = QCheckBox("🎙️  Lip-sync during TTS playback  (mouth opens/closes while speaking)")
        chk_ls_tts.setChecked(self.sd.get("lip_sync_tts", True))
        chk_ls_tts.setStyleSheet(CHKSS)
        tts_lay.addWidget(chk_ls_tts)

        chk_ls_txt = QCheckBox("💬  Lip-sync during text typing  (mouth moves per word, no audio needed)")
        chk_ls_txt.setChecked(self.sd.get("lip_sync_text", False))
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
        cur_eng = self.sd.get("tts_engine", "online")
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
        el_key_wrap, el_key_edit = self._eye_field("Paste ElevenLabs API key…", el.get("api_key", ""))
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
            mp = get_voice_path(self.sd)
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
        cur_piper = self.sd.get("selected_offline_voice", "")
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
            self.sd["tts_enabled"]  = chk_tts_on.isChecked()
            self.sd["lip_sync_tts"] = chk_ls_tts.isChecked()
            self.sd["lip_sync_text"]= chk_ls_txt.isChecked()
            self.sd["tts_engine"]   = tts_eng_box.itemData(tts_eng_box.currentIndex())
            CONFIG.setdefault("tts", {})["online_voice"] = edge_box.itemData(edge_box.currentIndex())
            CONFIG["elevenlabs"] = {
                "api_key":  el_key_edit.text().strip(),
                "voice_id": el_vid_inp.text().strip(),
                "model_id": el_mdl_box.currentText(),
            }
            sel_piper = piper_box.currentData()
            if sel_piper:
                self.sd["selected_offline_voice"] = sel_piper
        tts_lay.addStretch()
        tabs.addTab(tts_w, "🔊 TTS")

        # ═════════════════════════════════════════════════════════════════════
        # TAB 5 ── STT  (full mic tester suite)
        # ═════════════════════════════════════════════════════════════════════
        stt_w = QWidget(); stt_lay = QVBoxLayout(stt_w)
        stt_lay.setContentsMargins(16, 14, 16, 14); stt_lay.setSpacing(4)
        stt_cfg = CONFIG.get("stt", {})

        _sec(stt_lay, "🎤  Engine & Model")
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
            persist_save(self.sd); save_config()
            eng_lbl = {"elevenlabs":"ElevenLabs 🎙️","online":"edge-tts 🌐","offline":"Piper 💾"
                       }.get(self.sd.get("tts_engine","online"), self.sd.get("tts_engine","online"))
            self._display(f"Settings saved! TTS {'ON' if self.sd.get('tts_enabled') else 'OFF'} — {eng_lbl} [EMOTION: happy] ✨")
            dlg.accept()
        close_btn.clicked.connect(_on_close)
        outer.addWidget(close_btn)
        dlg.setFixedWidth(560)
        dlg.show()
        QTimer.singleShot(80, lambda: dlg.resize(
            560,
            min(dlg.sizeHint().height(), dlg.maximumHeight())
        ))

    def _mem_dlg(self):
        th = TH._active
        dlg = self._dlg_base("🧠 Memory", w=380, h=420)
        lay = QVBoxLayout(dlg._content)
        hdr = QLabel("🧠  Memory")
        hdr.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hdr.setStyleSheet(f"font-size:14px;font-weight:bold;color:{th['ACC3']};padding:8px 0")
        lay.addWidget(hdr)
        sc = QScrollArea(); sc.setWidgetResizable(True)
        sc.setStyleSheet("background:transparent;border:none")
        inn = QWidget(); il = QVBoxLayout(inn); il.setSpacing(2)
        entries = self.traits or []
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
        self._save_btn(dlg, lay, dlg.accept)
        dlg.show()



    # ── Theme picker dialog ───────────────────────────────────────────────────
    def _theme_picker_dlg(self):
        dlg = self._dlg_base("🎨  Theme", w=420, h=560)
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

        cur = self.sd.get("theme", TH.DEFAULT_THEME)
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
                    self._apply_theme_and_save(n)
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


    # ── Eye button helper — wraps a password QLineEdit with a show/hide toggle ──
    def _eye_field(self, placeholder="", initial="") -> tuple:
        """Returns (container_widget, QLineEdit) with an 👁 toggle button."""
        t = TH._active
        container = QWidget()
        row = QHBoxLayout(container)
        row.setContentsMargins(0, 0, 0, 0); row.setSpacing(4)
        edit = QLineEdit(initial)
        edit.setPlaceholderText(placeholder)
        edit.setEchoMode(QLineEdit.EchoMode.Password)
        edit.setStyleSheet("")  # inherits from dialog
        row.addWidget(edit, 1)
        eye = QPushButton("👁")
        eye.setFixedSize(34, 34)
        eye.setCheckable(True)
        eye.setCursor(Qt.CursorShape.PointingHandCursor)
        eye.setToolTip("Show / hide key")
        eye.setProperty("class", "eye")
        eye.setStyleSheet(
            "QPushButton{background:transparent;border:1px solid rgba(255,255,255,0.15);"
            "border-radius:8px;font-size:16px;color:rgba(255,255,255,0.5);padding:0}"
            "QPushButton:hover{border-color:rgba(255,255,255,0.5);color:rgba(255,255,255,0.9)}"
            "QPushButton:checked{color:white;border-color:white}"
        )
        def _toggle(checked):
            edit.setEchoMode(
                QLineEdit.EchoMode.Normal if checked else QLineEdit.EchoMode.Password
            )
        eye.toggled.connect(_toggle)
        row.addWidget(eye)
        return container, edit

    # ── Shared dialog helpers ─────────────────────────────────────────────────
    def _dlg_base(self, title, w=420, h=None):
        from PyQt6.QtGui import QPainterPath, QRegion
        from PyQt6.QtCore import QRectF
        t   = TH._active
        b1  = t["BG1"];  b2 = t["BG2"];  b3 = t["BG3"];  b4 = t["BG4"]
        a1  = t["ACC1"]; a2 = t["ACC2"]; a3 = t["ACC3"]
        tx1 = t["TXT1"]; tx2 = t["TXT2"]; bd = t["BORDER"]
        R = 14

        class _D(QDialog):
            def _mask(self_):
                p = QPainterPath()
                p.addRoundedRect(QRectF(self_.rect()), R, R)
                self_.setMask(QRegion(p.toFillPolygon().toPolygon()))
            def showEvent(self_, e):
                super().showEvent(e)
                self_._mask()
                # Auto-center on primary screen once per dialog instance
                if not getattr(self_, '_centered', False):
                    self_._centered = True
                    from PyQt6.QtWidgets import QApplication
                    scr = QApplication.primaryScreen().availableGeometry()
                    self_.move(scr.center() - self_.rect().center())
            def resizeEvent(self_, e): super().resizeEvent(e); self_._mask()

        dlg = _D(None)
        dlg.setWindowTitle(title)
        dlg.setWindowFlags(Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint)
        dlg.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, False)
        dlg.setStyleSheet(f"QDialog{{background:{b1};border:1.5px solid {a2};border-radius:{R}px;}}")
        if w: dlg.setMinimumWidth(w)
        # Never use setFixedHeight — it prevents the dialog from breathing on short screens.
        # Clamp to available screen height on every monitor/resolution.
        from PyQt6.QtWidgets import QApplication
        _avail_h = QApplication.primaryScreen().availableGeometry().height() - 80
        if h:
            dlg.setMinimumHeight(min(h, _avail_h))   # start at intended size...
        dlg.setMaximumHeight(_avail_h)                # ...but never bleed off-screen

        # ── Stylesheet for child widgets ──────────────────────────────────────
        CHILD_SS = f"""
            QWidget            {{ background:transparent; color:{tx1}; outline:0; }}
            QTabWidget::pane   {{ background:{b2}; border:1px solid {bd}; border-radius:8px; }}
            QTabBar::tab       {{ background:{b3}; color:{tx2}; padding:8px 16px;
                                  border-radius:6px 6px 0 0; font-size:12px; outline:0 }}
            QTabBar::tab:selected {{ background:{a2}; color:white; font-weight:bold }}
            QTabBar::tab:hover    {{ background:{b4}; color:{a1} }}
            QLineEdit  {{ background:{b3}; border:1px solid {bd}; border-radius:9px;
                          padding:8px 12px; font-size:13px; color:{tx1} }}
            QLineEdit:focus {{ border:1.5px solid {a1}; background:{b4}; outline:0 }}
            QSpinBox   {{ background:{b3}; border:1px solid {bd}; border-radius:9px;
                          padding:7px 12px; font-size:13px; color:{tx1}; outline:0 }}
            QSpinBox::up-button, QSpinBox::down-button {{
                          background:{b4}; border-radius:4px; border:none; width:16px }}
            QSpinBox::up-button:hover, QSpinBox::down-button:hover {{ background:{a2} }}
            QComboBox  {{ background:{b3}; border:1px solid {bd}; border-radius:9px;
                          padding:7px 12px 7px 12px; font-size:13px; color:{tx1}; outline:0 }}
            QComboBox:focus {{ border:1px solid {a1}; outline:0 }}
            QComboBox::drop-down {{ subcontrol-origin:padding; subcontrol-position:right center;
                          width:28px; border:none; background:{b4};
                          border-top-right-radius:9px; border-bottom-right-radius:9px; }}
            QComboBox::down-arrow {{ width:0; height:0; image:none;
                          border-left:5px solid transparent; border-right:5px solid transparent;
                          border-top:6px solid {tx2}; }}
            QComboBox:hover::down-arrow {{ border-top-color:{a1}; }}
            QComboBox QAbstractItemView {{ background:{b2}; color:{tx1};
                          selection-background-color:{a2}; outline:0;
                          border:1px solid {bd}; border-radius:8px; padding:4px; }}
            QLabel     {{ color:{tx2}; font-size:12px }}
            QCheckBox  {{ color:{tx2}; font-size:12px; spacing:8px }}
            QCheckBox::indicator {{ width:17px; height:17px; border:1.5px solid {a2};
                          border-radius:5px; background:{b3} }}
            QCheckBox::indicator:checked {{ background:{a2}; border-color:{a2} }}
            QSlider::groove:horizontal {{ background:{b3}; height:6px; border-radius:3px }}
            QSlider::handle:horizontal {{ background:{a1}; width:16px; height:16px;
                          border-radius:8px; margin:-5px 0 }}
            QSlider::sub-page:horizontal {{ background:{a2}; border-radius:3px }}
            QPushButton {{ background:{b3}; border:1px solid {bd}; border-radius:9px;
                           padding:8px 16px; color:{tx1}; font-size:12px }}
            QPushButton:hover {{ border-color:{a1}; color:{a1} }}
            QPushButton[class="eye"] {{ background:transparent; border:1px solid {bd};
                           border-radius:8px; padding:0; font-size:16px; color:{tx2} }}
            QPushButton[class="eye"]:hover   {{ border-color:{a1}; color:{a1} }}
            QPushButton[class="eye"]:checked {{ border-color:{a1}; color:{a1} }}
            QPushButton[class="stat-minus"] {{ background:#c0392b; border:none;
                           border-radius:7px; padding:0; color:white; font-size:14px }}
            QPushButton[class="stat-minus"]:hover {{ background:#e74c3c }}
            QPushButton[class="stat-plus"]  {{ background:#27ae60; border:none;
                           border-radius:7px; padding:0; color:white; font-size:14px }}
            QPushButton[class="stat-plus"]:hover  {{ background:#2ecc71 }}
            QScrollArea {{ background:transparent; border:none }}
            QScrollBar:vertical {{ background:{b2}; width:6px; border-radius:3px }}
            QScrollBar::handle:vertical {{ background:{a2}; border-radius:3px; min-height:20px }}
            QScrollBar::add-line:vertical,
            QScrollBar::sub-line:vertical {{ height:0 }}
        """

        # ── Root layout ───────────────────────────────────────────────────────
        root = QVBoxLayout(dlg)
        root.setContentsMargins(0, 0, 0, 12)
        root.setSpacing(0)

        # ── Title bar ─────────────────────────────────────────────────────────
        tbar = QFrame(); tbar.setFixedHeight(42)
        tbar.setStyleSheet(
            f"QFrame {{ background:{b2}; border-bottom:1px solid {bd};"
            f"border-top-left-radius:14px; border-top-right-radius:14px; }}"
        )
        tbl = QHBoxLayout(tbar)
        tbl.setContentsMargins(14, 0, 10, 0); tbl.setSpacing(8)
        name_lbl = QLabel(title)
        name_lbl.setStyleSheet(
            f"font-size:13px;font-weight:bold;color:{tx1};"
            f"letter-spacing:1px;background:transparent;border:none"
        )
        tbl.addWidget(name_lbl); tbl.addStretch()
        for col, slot in [("#ffbd2e", dlg.showMinimized), ("#ff5f57", dlg.reject)]:
            b = QPushButton(); b.setFixedSize(13, 13)
            b.setStyleSheet(
                f"QPushButton{{background:{col};border-radius:6px;border:none}}"
            )
            b.clicked.connect(slot); tbl.addWidget(b)
        root.addWidget(tbar)

        # ── Content area ──────────────────────────────────────────────────────
        dlg._content = QWidget()
        dlg._content.setStyleSheet(CHILD_SS)
        root.addWidget(dlg._content, 1)

        # ── Drag via title bar ────────────────────────────────────────────────
        _d = [None]
        def _mp(e):
            if e.button() == Qt.MouseButton.LeftButton:
                _d[0] = e.globalPosition().toPoint() - dlg.pos()
        def _mm(e):
            if _d[0] and e.buttons() & Qt.MouseButton.LeftButton:
                dlg.move(e.globalPosition().toPoint() - _d[0])
        def _mr(e): _d[0] = None
        tbar.mousePressEvent   = _mp
        tbar.mouseMoveEvent    = _mm
        tbar.mouseReleaseEvent = _mr

        return dlg

    def _save_btn(self, dlg, lay, on_save):
        row = QHBoxLayout()
        cancel = QPushButton("Cancel")
        cancel.setStyleSheet(f"QPushButton{{background:{BG3};border:1px solid rgba(192,132,252,0.3);border-radius:8px;padding:8px 20px;color:{TXT1}}}QPushButton:hover{{background:rgba(192,132,252,0.15)}}")
        cancel.clicked.connect(dlg.reject)
        save = QPushButton("💾  Save")
        save.setStyleSheet(f"QPushButton{{background:qlineargradient(x1:0,y1:0,x2:1,y2:1,stop:0 {PINK},stop:1 {PURPLE});border:none;border-radius:8px;padding:8px 20px;color:white;font-weight:bold}}QPushButton:hover{{opacity:0.9}}")
        save.clicked.connect(on_save)
        row.addWidget(cancel); row.addStretch(); row.addWidget(save)
        lay.addLayout(row)

    def _field_row(self, form, label, widget, hint=""):
        lbl = QLabel(label)
        if hint:
            lbl.setToolTip(hint)
        form.addRow(lbl, widget)

    # ── AI / API Settings dialog ──────────────────────────────────────────────
    def _ai_settings_dlg(self):
        dlg  = self._dlg_base("🌐 AI / API Settings", w=460)
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
        cur_bm  = self.sd.get("brain_mode", "local")
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
            self.sd["brain_mode"] = v; persist_save(self.sd); self._upd_brain()
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
        e_lkey_w, e_lkey = self._eye_field("Leave blank for LM Studio", CONFIG.get("local_api_key",""))
        e_lmdl  = QLineEdit(CONFIG.get("local_api_model","local-model"))
        self._field_row(fl, "API URL",   e_lurl,  "LM Studio server URL")
        self._field_row(fl, "API Key",   e_lkey_w,  "Leave blank for LM Studio")
        self._field_row(fl, "Model",     e_lmdl,  "Model name / identifier")
        tabs.addTab(tp_local, "🖥  Local")

        # ── Tab: Online (OpenAI / Groq) ───────────────────────────────────────
        tp_onl  = QWidget(); fo = QFormLayout(tp_onl); fo.setSpacing(10); fo.setContentsMargins(16,16,16,8)
        e_ourl  = QLineEdit(CONFIG.get("online_api_url",  "https://api.openai.com/v1/chat/completions"))
        e_okey_w, e_okey = self._eye_field("Paste your API key...", CONFIG.get("online_api_key",""))
        e_omdl  = QLineEdit(CONFIG.get("online_api_model","gpt-4o-mini"))
        self._field_row(fo, "API URL",   e_ourl,  "OpenAI / Groq / any OpenAI-compat URL")
        self._field_row(fo, "API Key",   e_okey_w,  "Your API key")
        self._field_row(fo, "Model",     e_omdl,  "e.g. gpt-4o, llama-3.3-70b-versatile")
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
            self._display("*reconfiguring* API settings saved! [EMOTION: happy] 💾")

        self._save_btn(dlg, lay, _save)
        dlg.show()

    # ── Minecraft Settings dialog ─────────────────────────────────────────────
    def _mc_settings_dlg(self):
        dlg = self._dlg_base("🎮 Minecraft Settings", w=460)
        lay = QVBoxLayout(dlg._content)

        hdr = QLabel("🎮  Minecraft Bot Settings")
        hdr.setStyleSheet(f"font-size:15px;font-weight:bold;color:{CYAN};padding:8px 0")
        hdr.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(hdr)

        tabs = QTabWidget(); lay.addWidget(tabs, 1)
        mc   = CONFIG.get("minecraft", {})

        # ── Tab: Server connection ────────────────────────────────────────────
        tp_srv = QWidget(); fs = QFormLayout(tp_srv); fs.setSpacing(10); fs.setContentsMargins(16,16,16,8)

        e_host = QLineEdit(mc.get("host",     "localhost"))
        e_port = QSpinBox(); e_port.setRange(1, 65535); e_port.setValue(int(mc.get("port", 25565)))
        e_user = QLineEdit(mc.get("username", "RavenBot"))
        e_ver  = QComboBox()
        e_ver.setEditable(True)   # allows typing any version like 1.21.10
        e_ver.setInsertPolicy(QComboBox.InsertPolicy.InsertAtTop)
        for v in ["1.21.4", "1.21.3", "1.21.1", "1.21", "1.20.6",
                  "1.20.4", "1.20.2", "1.20.1", "1.19.4", "1.18.2", "1.17.1", "1.16.5"]:
            e_ver.addItem(v)
        cur_ver = mc.get("version", "1.21")
        idx = e_ver.findText(cur_ver)
        if idx >= 0:
            e_ver.setCurrentIndex(idx)
        else:
            e_ver.setCurrentText(cur_ver)   # custom version not in list — just show it

        e_auth = QComboBox()
        e_auth.addItems(["offline", "microsoft"])
        e_auth.setCurrentText(mc.get("auth", "offline"))

        e_wsp  = QSpinBox(); e_wsp.setRange(1024, 65535); e_wsp.setValue(int(mc.get("ws_port", 8765)))

        self._field_row(fs, "Server IP",      e_host, "Server hostname or IP address")
        self._field_row(fs, "Port",           e_port, "Default: 25565")
        self._field_row(fs, "Bot Username",   e_user, "Name shown in-game")
        self._field_row(fs, "MC Version",     e_ver,  "Must match your server — type any version e.g. 1.21.10")
        self._field_row(fs, "Auth Mode",      e_auth, "offline = cracked, microsoft = premium account")
        self._field_row(fs, "WS Bridge Port", e_wsp,  "Internal port Python↔drone.bot.js use (don't change unless conflict)")
        tabs.addTab(tp_srv, "🖥  Server")

        # ── Tab: Minecraft brain (100B model) ─────────────────────────────────
        tp_br  = QWidget(); fb = QFormLayout(tp_br); fb.setSpacing(10); fb.setContentsMargins(16,16,16,8)

        e_burl = QLineEdit(mc.get("brain_url",   "https://api.openai.com/v1/chat/completions"))
        e_bkey_w, e_bkey = self._eye_field("Minecraft brain API key", mc.get("brain_key",""))
        e_bmdl = QLineEdit(mc.get("brain_model", ""))

        self._field_row(fb, "Brain URL",   e_burl, "API endpoint for the Minecraft brain model")
        self._field_row(fb, "Brain Key",   e_bkey_w, "API key for the Minecraft brain model")
        self._field_row(fb, "Brain Model", e_bmdl, "e.g. openai/gpt-oss-120b, llama-3.3-70b-versatile")

        # ── AI feature toggles ────────────────────────────────────────────────
        fb.addRow(QLabel(""))   # spacer
        ai_hdr = QLabel("🤖  AI Features  (everything else is instant & local)")
        ai_hdr.setStyleSheet(f"color:{CYAN};font-weight:bold;font-size:12px")
        fb.addRow(ai_hdr)

        ai_feats = mc.get("ai_features", {})

        def _ai_chk(key, label, default=False, hint=""):
            chk = QCheckBox(label)
            chk.setChecked(ai_feats.get(key, default))
            if hint: chk.setToolTip(hint)
            return chk

        chk_hash  = _ai_chk("ai_hash_chat",   "✅ Respond to #chat in-game  (RECOMMENDED ON)",  True,
                             "When a player types #hello in MC chat, she responds with AI")
        chk_adv   = _ai_chk("ai_advancements","🏆 AI reacts to achievements",  False,
                             "Use AI to react to advancements (slower but more unique)")
        chk_task  = _ai_chk("ai_task_done",   "⚒ AI reacts to task completion", False)
        chk_events= _ai_chk("ai_events",      "⚡ AI reacts to game events (death, kicks)", False)

        fb.addRow(chk_hash)
        fb.addRow(chk_adv)
        fb.addRow(chk_task)
        fb.addRow(chk_events)

        tabs.addTab(tp_br, "🧠  Brain")

        # ── Tab: Console ─────────────────────────────────────────────────────
        from PyQt6.QtWidgets import QTextEdit
        tp_con = QWidget(); con_lay = QVBoxLayout(tp_con)
        con_lay.setContentsMargins(0, 0, 0, 0); con_lay.setSpacing(0)

        con_log = QTextEdit()
        con_log.setReadOnly(True)
        con_log.setStyleSheet(
            f"QTextEdit{{background:{BG1};color:{TXT2};border:none;"
            f"font-family:'Courier New',monospace;font-size:11px;padding:6px}}"
        )
        # Populate from buffer
        if hasattr(self, '_mc_console_buf'):
            for line, color in self._mc_console_buf[-200:]:
                con_log.append(f'<span style="color:{color};">{line}</span>')
        con_log.verticalScrollBar().setValue(con_log.verticalScrollBar().maximum())
        con_lay.addWidget(con_log, 1)

        # Live update: connect a slot so new log lines appear while dialog is open
        def _append(line, color):
            con_log.append(f'<span style="color:{color};">{line}</span>')
            con_log.verticalScrollBar().setValue(con_log.verticalScrollBar().maximum())
        self._mc_console_live = _append   # stored so _mc_console_log can call it

        # Input row
        con_inp_row = QHBoxLayout()
        con_inp_row.setContentsMargins(8, 4, 8, 8); con_inp_row.setSpacing(6)
        con_inp = QLineEdit()
        con_inp.setPlaceholderText("% command   or   plain chat message...")
        con_inp.setFixedHeight(32)
        con_inp.setStyleSheet(
            f"QLineEdit{{background:{BG3};border:1px solid {_c('BORDER')};"
            f"border-radius:8px;padding:0 10px;color:{TXT1};font-size:12px}}"
            f"QLineEdit:focus{{border-color:{PINK}}}"
        )
        con_send_btn = QPushButton("Send ↵"); con_send_btn.setFixedHeight(32)
        con_send_btn.setStyleSheet(
            f"QPushButton{{background:{PURPLE};border:none;border-radius:8px;"
            f"padding:0 14px;color:white;font-weight:bold;font-size:12px}}"
            f"QPushButton:hover{{background:{PINK}}}"
        )
        def _con_send():
            text = con_inp.text().strip()
            if not text: return
            con_inp.clear()
            self._mc_console_log(f"→ {text}", color=CYAN)
            if text.startswith('%'):
                self._send_mc_percent_text(text)
            else:
                self._mc_send_cmd("chat", {"message": text})
        con_inp.returnPressed.connect(_con_send)
        con_send_btn.clicked.connect(_con_send)
        con_inp_row.addWidget(con_inp, 1); con_inp_row.addWidget(con_send_btn)
        con_inp_w = QWidget(); con_inp_w.setLayout(con_inp_row)
        con_lay.addWidget(con_inp_w)

        # Clear live reference when dialog closes
        dlg.finished.connect(lambda _: setattr(self, '_mc_console_live', None))

        tabs.addTab(tp_con, "📟  Console")

        # ── Tab: Tasks ────────────────────────────────────────────────────────
        from PyQt6.QtWidgets import QListWidget, QListWidgetItem, QSplitter
        tp_tasks = QWidget()
        tlay = QVBoxLayout(tp_tasks)
        tlay.setContentsMargins(10, 10, 10, 8); tlay.setSpacing(6)

        # ── Live queue display ────────────────────────────────────────────────
        qlbl = QLabel("📋  Live Task Queue")
        qlbl.setStyleSheet(f"color:{CYAN};font-weight:bold;font-size:12px")
        tlay.addWidget(qlbl)

        # Queue list widget — each task gets its own row with an ✕ stop button
        self._task_queue_list_widget = QListWidget()
        self._task_queue_list_widget.setFixedHeight(80)
        self._task_queue_list_widget.setStyleSheet(
            f"QListWidget{{background:{BG3};border:1px solid {_c('BORDER')};"
            f"border-radius:8px;color:{TXT1};font-size:11px;padding:2px}}"
            f"QListWidget::item{{padding:2px 4px;border-radius:4px}}"
            f"QListWidget::item:selected{{background:{_c('GLOW')}}}"
        )
        tlay.addWidget(self._task_queue_list_widget)

        # Stop All + Follow buttons only
        stop_row = QHBoxLayout(); stop_row.setSpacing(6)
        def _mk_stop_btn(text, cmd, color):
            b = QPushButton(text); b.setFixedHeight(28)
            b.setStyleSheet(
                f"QPushButton{{background:{color};border:none;border-radius:8px;"
                f"font-size:11px;font-weight:bold;color:white;padding:0 10px}}"
                f"QPushButton:hover{{opacity:0.85}}"
            )
            b.clicked.connect(lambda: self._send_mc_percent_text(cmd))
            return b
        stop_row.addWidget(_mk_stop_btn("✕  Stop All", "%stop",   "#cc3333"))
        stop_row.addWidget(_mk_stop_btn("👁 Follow",   "%follow", "#336699"))
        sw = QWidget(); sw.setLayout(stop_row); tlay.addWidget(sw)

        # ── Add task section ──────────────────────────────────────────────────
        add_lbl = QLabel("➕  Add Task")
        add_lbl.setStyleSheet(f"color:{CYAN};font-weight:bold;font-size:12px;margin-top:4px")
        tlay.addWidget(add_lbl)

        add_row = QHBoxLayout(); add_row.setSpacing(6)
        task_combo = QComboBox()
        task_combo.setFixedHeight(30)
        task_combo.setStyleSheet(
            f"QComboBox{{background:{BG3};border:1px solid {_c('BORDER')};border-radius:8px;"
            f"padding:0 10px;color:{TXT1};font-size:11px}}"
            f"QComboBox::drop-down{{border:none;border-top-right-radius:8px;border-bottom-right-radius:8px}}"
            f"QComboBox::down-arrow{{image:none;border-left:4px solid transparent;"
            f"border-right:4px solid transparent;border-top:6px solid {TXT2};margin-right:8px}}"
            f"QComboBox QAbstractItemView{{background:{BG3};color:{TXT1};border:1px solid {_c('BORDER')};"
            f"selection-background-color:{PURPLE}}}"
        )
        # Cleaned task list — no duplicate mine entries, guard/follow come first
        TASK_DEFS = [
            ("👁 Follow me",           "%follow",         ""),
            ("🛡 Guard me",            "%guard {arg}",    "radius  e.g. 10"),
            ("⛏ Mine block",          "%mine {arg} 16",  "block count  e.g. diamond 32"),
            ("🕳 Cave mine",           "%cave",           ""),
            ("📏 Strip mine",          "%strip {arg}",    "length  e.g. 50"),
            ("🚇 Tunnel",              "%tunnel {arg}",   "length  e.g. 20"),
            ("☀️ Go to surface",       "%surface",        ""),
            ("🗺 Explore",             "%explore {arg}",  "radius  e.g. 200"),
            ("🌲 Chop trees",          "%lumber",         ""),
            ("🌾 Farm crops",          "%farm",           ""),
            ("💀 Kill all nearby",     "%killall {arg}",  "radius  e.g. 20"),
            ("🧟 Kill mob",            "%kill {arg} 5",   "mob count  e.g. zombie 10"),
            ("🏹 Go to coords",        "%goto {arg}",     "x y z  e.g. 10 64 -30"),
            ("🏃 Come to me",          "%come",           ""),
            ("🛌 Sleep",               "%sleep",          ""),
            ("🎣 Fish",                "%fish {arg}",     "seconds  e.g. 60"),
            ("🎒 Show inventory",      "%inv",            ""),
            ("📊 Status report",       "%status",         ""),
            ("📍 Where are you",       "%pos",            ""),
            ("🗑 Drop all",            "%dropall",        ""),
            ("📦 Link nearest chest",  "%chest link",     ""),
            ("📥 Store in chest",      "%store {arg}",    "item (blank=all)"),
            ("📤 Loot chest",          "%loot",           ""),
            ("🔨 Craft item",          "%craft {arg}",    "item  e.g. diamond_pickaxe 1"),
            ("🔥 Smelt item",          "%smelt {arg}",    "item count  e.g. iron_ore 16"),
            ("⬆ Pillar up",            "%pillar {arg}",   "height  e.g. 10"),
            ("🕯 Place torches",       "%torch {arg}",    "count  e.g. 5"),
            ("📦 Bring item",          "%bring {arg}",    "item count  e.g. diamond 16"),
            ("😊 Emote",              "%emote {arg}",    "shrug|wave|happy|sad|love|..."),
        ]
        for lbl, _, _ in TASK_DEFS:
            task_combo.addItem(lbl)
        add_row.addWidget(task_combo, 2)

        task_arg = QLineEdit()
        task_arg.setFixedHeight(30)
        task_arg.setPlaceholderText("arg (if needed)")
        task_arg.setStyleSheet(
            f"QLineEdit{{background:{BG3};border:1px solid {_c('BORDER')};border-radius:8px;"
            f"padding:0 8px;color:{TXT1};font-size:11px}}"
            f"QLineEdit:focus{{border-color:{PINK}}}"
        )
        add_row.addWidget(task_arg, 2)

        add_btn = QPushButton("+ Queue"); add_btn.setFixedHeight(30)
        add_btn.setStyleSheet(
            f"QPushButton{{background:{PURPLE};border:none;border-radius:8px;"
            f"padding:0 12px;color:white;font-weight:bold;font-size:11px}}"
            f"QPushButton:hover{{background:{PINK}}}"
        )
        add_row.addWidget(add_btn)
        add_w = QWidget(); add_w.setLayout(add_row); tlay.addWidget(add_w)

        arg_hint = QLabel("")
        arg_hint.setStyleSheet(f"color:{TXT2};font-size:10px;margin-left:2px")
        tlay.addWidget(arg_hint)

        def _on_task_changed(idx):
            _, _, hint = TASK_DEFS[idx]
            arg_hint.setText(hint)
            task_arg.setPlaceholderText(hint if hint else "no arg needed")
            task_arg.setEnabled(bool(hint))
        task_combo.currentIndexChanged.connect(_on_task_changed)
        _on_task_changed(0)

        def _queue_task():
            idx = task_combo.currentIndex()
            _, cmd_tpl, hint = TASK_DEFS[idx]
            arg = task_arg.text().strip()
            if '{arg}' in cmd_tpl:
                if not arg: task_arg.setFocus(); return
                cmd = cmd_tpl.replace('{arg}', arg)
            else:
                cmd = cmd_tpl
            self._send_mc_percent_text(cmd)
            task_arg.clear()
        add_btn.clicked.connect(_queue_task)
        task_arg.returnPressed.connect(_queue_task)

        # ── Auto-rules ────────────────────────────────────────────────────────
        rules_lbl = QLabel("⚡  Auto-Rules")
        rules_lbl.setStyleSheet(f"color:{CYAN};font-weight:bold;font-size:12px;margin-top:4px")
        tlay.addWidget(rules_lbl)
        rules = [
            ("guard_on_low_hp",  "🩸 Guard me when I'm hurt"),
            ("collect_on_death", "💀 Auto-collect items after dying"),
        ]
        self._auto_rule_checks = {}
        saved_rules = CONFIG.get("mc_auto_rules", {})
        for key, label in rules:
            chk = QCheckBox(label)
            chk.setChecked(saved_rules.get(key, key=="collect_on_death"))
            chk.setStyleSheet(f"color:{TXT1};font-size:11px")
            tlay.addWidget(chk)
            self._auto_rule_checks[key] = chk

        tlay.addStretch()

        tabs.addTab(tp_tasks, "📋  Tasks")

        # ── Tab: Commands Reference ───────────────────────────────────────────
        tp_cmds = QWidget(); cmds_lay = QVBoxLayout(tp_cmds)
        cmds_lay.setContentsMargins(0,0,0,0); cmds_lay.setSpacing(0)

        cmds_scroll = QScrollArea(); cmds_scroll.setWidgetResizable(True)
        cmds_scroll.setStyleSheet("QScrollArea{border:none;background:transparent}")
        cmds_inner = QWidget()
        cmds_inner_lay = QVBoxLayout(cmds_inner)
        cmds_inner_lay.setContentsMargins(12,12,12,8); cmds_inner_lay.setSpacing(2)
        cmds_scroll.setWidget(cmds_inner)
        cmds_lay.addWidget(cmds_scroll)

        CMD_REF = [
            ("⛏  Mining & Gathering", [
                ("%mine <block> [n]",      "Mine n of a block. Auto-goes to correct depth."),
                ("%cave",                  "Cave mine all ores at Y=-53 until stopped."),
                ("%strip [len]",           "Strip mine at Y=11, checks sides for ores."),
                ("%tunnel [len]",          "Dig straight tunnel in facing direction."),
                ("%surface",               "Path or dig to Y=65."),
                ("%explore [r]",           "Random-walk exploration over radius r."),
                ("%lumber",                "Chop all nearby logs until none found."),
                ("%farm",                  "Harvest mature wheat/carrots/potatoes/beetroots."),
            ]),
            ("⚔  Combat", [
                ("%guard [r]",             "Guard you FOREVER within r blocks. (%stop guard)"),
                ("%kill <mob> [n]",        "Hunt and kill n of a mob type."),
                ("%killall [r]",           "Kill every hostile within r blocks."),
            ]),
            ("🧭  Navigation", [
                ("%goto <x> <y> <z>",      "Pathfind to exact coordinates."),
                ("%come",                  "Come to your current position."),
                ("%follow [player]",       "Switch to follow mode."),
                ("%pos / %where",          "Print current coordinates in chat."),
            ]),
            ("❤  Survival", [
                ("%eat",                   "Eat the best food in inventory."),
                ("%heal",                  "Use a health potion or golden apple."),
                ("%wear",                  "Equip the best armor available."),
                ("%use <item>",            "Activate/drink/throw an item."),
                ("%sleep",                 "Find nearest bed and sleep."),
                ("%fish [secs]",           "Fish for the given duration."),
            ]),
            ("🎒  Inventory", [
                ("%inv",                   "List all inventory items and counts."),
                ("%status",                "HP / Food / Pos / Held / XP / Queue."),
                ("%equip <item> [slot]",   "Equip item in hand or armor slot."),
                ("%drop <item> [n]",       "Drop n of an item."),
                ("%dropall",               "Drop every item in inventory."),
            ]),
            ("📦  Chest & Crafting", [
                ("%chest link",            "Link nearest chest for crafting/storage."),
                ("%store [item]",          "Store item (or all) in linked/nearest chest."),
                ("%loot",                  "Empty nearest chest into inventory."),
                ("%craft <item> [n]",      "Craft item. Checks chest if short on materials."),
                ("%smelt <item> [n]",      "Smelt item in nearest furnace."),
                ("%stop craft",            "Cancel craft and store materials in chest."),
            ]),
            ("🏗  Building", [
                ("%pillar [h]",            "Pillar up h blocks using cobblestone/dirt."),
                ("%torch [n]",             "Place n torches spaced along path."),
            ]),
            ("😊  Emotes  (%emote <name>)", [
                ("%emote shrug",    "\\_( ツ )_/"),
                ("%emote happy",    "(^_^)"),
                ("%emote sad",      "(T_T)"),
                ("%emote angry",    "(>_<)"),
                ("%emote love",     "(*^3^)"),
                ("%emote blush",    "(*^_^*)"),
                ("%emote wave",     "(^_^)/"),
                ("%emote yay",      "\\(^o^)/"),
                ("%emote cry",      "(;_;)"),
                ("%emote evil",     "(>:)"),
                ("%emote smug",     "(~_^)"),
                ("%emote think",    "(-_-)..."),
                ("%emote sleep",    "(-_-)zzz"),
                ("%emote surprised","(O_O)!!"),
                ("%emote confused", "(o_O)?"),
                ("%emote bow",      "m(_ _)m"),
                ("%emote ok",       "(^_^)b"),
                ("%emote no",       "(x_x)"),
                ("%emote nervous",  "(^_^;)"),
                ("%emote wink",     "(^_~)"),
                ("%emote peek",     "(._. )"),
                ("%emote hearts",   "(^3^)"),
                ("%emote pout",     "(-_-;)"),
                ("%emote stare",    "(-_-)"),
                ("%emote sweat",    "(>_<;)"),
            ]),
            ("👥  Social & Control", [
                ("%friend <player>",       "Trust player — no stranger warnings."),
                ("%unfriend <player>",     "Remove from trust list."),
                ("%friends",               "List all trusted players."),
                ("%stop",                  "Stop ALL tasks and clear queue."),
                ("%stop guard",            "Stop guard only."),
                ("%stop craft",            "Stop crafting, store materials."),
                ("%mode",                  "Show current mode (follow/task)."),
                ("%help",                  "Show command list in Minecraft chat."),
            ]),
            ("💬  Chat & AI", [
                ("#hello Raven!",          "Any message starting with # triggers AI response."),
                ("/w RavenBot hi",         "Whisper always triggers AI response."),
            ]),
        ]

        def _cmd_section(lbl):
            h = QLabel(lbl)
            h.setStyleSheet(f"color:{CYAN};font-size:11px;font-weight:bold;margin-top:10px;margin-bottom:2px")
            cmds_inner_lay.addWidget(h)

        def _cmd_row(cmd, desc):
            row_w = QWidget()
            row_l = QHBoxLayout(row_w); row_l.setContentsMargins(0,0,0,0); row_l.setSpacing(8)
            # clickable command chip
            chip = QPushButton(cmd); chip.setFixedHeight(22)
            chip.setCursor(Qt.CursorShape.PointingHandCursor)
            chip.setStyleSheet(
                f"QPushButton{{background:{BG3};border:1px solid {_c('BORDER')};"
                f"border-radius:6px;padding:0 8px;font-size:10px;color:{PINK};"
                f"font-family:'Courier New',monospace;text-align:left}}"
                f"QPushButton:hover{{background:{BG4};border-color:{PINK}}}"
            )
            # If it's a real % command (not an emote display), clicking sends it
            if cmd.startswith('%') and '<' not in cmd and '[' not in cmd and '...' not in cmd:
                chip.clicked.connect(lambda _, c=cmd: self._send_mc_percent_text(c))
            chip.setMinimumWidth(160)
            chip.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
            row_l.addWidget(chip)
            d = QLabel(desc); d.setWordWrap(True)
            d.setStyleSheet(f"color:{TXT2};font-size:10px")
            row_l.addWidget(d, 1)
            cmds_inner_lay.addWidget(row_w)

        for section_title, cmds in CMD_REF:
            _cmd_section(section_title)
            for cmd, desc in cmds:
                _cmd_row(cmd, desc)

        cmds_inner_lay.addStretch()
        tabs.addTab(tp_cmds, "📖  Commands")

        # ── Tab: Radar ────────────────────────────────────────────────────────
        tp_radar_mc = QWidget()
        rmc_lay = QVBoxLayout(tp_radar_mc)
        rmc_lay.setContentsMargins(12, 12, 12, 12); rmc_lay.setSpacing(8)

        rmc_hdr = QLabel("🛰  Vampire Sense Radar")
        rmc_hdr.setStyleSheet(f"font-size:14px;font-weight:bold;color:{CYAN}")
        rmc_hdr.setAlignment(Qt.AlignmentFlag.AlignCenter)
        rmc_lay.addWidget(rmc_hdr)

        rmc_sub = QLabel("Red = hostile mobs   Blue = players   White = you\nUpdates every 2s from drone.bot.js.  32-block world radius.")
        rmc_sub.setStyleSheet(f"font-size:11px;color:{_c('TXT2')};text-align:center")
        rmc_sub.setAlignment(Qt.AlignmentFlag.AlignCenter)
        rmc_lay.addWidget(rmc_sub)

        # Start/Stop button
        rmc_btn = QPushButton("▶  Start Radar")
        rmc_btn.setFixedHeight(32); rmc_btn.setCheckable(True)
        rmc_btn.setStyleSheet(
            f"QPushButton{{background:{_c('BG3')};border:1px solid {_c('BORDER')};"
            f"border-radius:8px;color:{_c('TXT1')};font-size:13px}}"
            f"QPushButton:checked{{background:rgba(0,255,65,0.12);border-color:#00ff41;color:#00ff41}}"
        )
        rmc_lay.addWidget(rmc_btn)

        # Radar widget — embedded in dialog
        rmc_radar = _RadarWidget()
        rmc_radar.setFixedHeight(220)
        rmc_lay.addWidget(rmc_radar, 1)

        def _rmc_toggle(checked):
            rmc_radar.set_active(checked)
            rmc_btn.setText("⏹  Stop Radar" if checked else "▶  Start Radar")
            rmc_radar.update()

        rmc_btn.toggled.connect(_rmc_toggle)

        # Connect sig_radar → this dialog's radar widget too
        # Store connection so we can disconnect when dialog closes
        _rmc_conn = self._mc_bridge.sig_radar.connect(
            lambda ents: rmc_radar.update_entities(ents)
        )
        dlg.finished.connect(lambda _: self._mc_bridge.sig_radar.disconnect(_rmc_conn))

        rmc_lay.addStretch()
        tabs.addTab(tp_radar_mc, "🛰  Radar")

        # ── Tab: Inventory + Stats ────────────────────────────────────────────
        tp_inv = QWidget()
        inv_lay = QVBoxLayout(tp_inv)
        inv_lay.setContentsMargins(12, 12, 12, 12); inv_lay.setSpacing(8)

        inv_hdr = QLabel("🎒  Bot Inventory  ·  📊 Stats  ·  📍 Coords")
        inv_hdr.setStyleSheet(f"font-size:13px;font-weight:bold;color:{CYAN}")
        inv_hdr.setAlignment(Qt.AlignmentFlag.AlignCenter)
        inv_lay.addWidget(inv_hdr)

        inv_start_btn = QPushButton("▶  Start Tracking")
        inv_start_btn.setFixedHeight(30); inv_start_btn.setCheckable(True)
        inv_start_btn.setStyleSheet(
            f"QPushButton{{background:{BG3};border:1px solid {_c('BORDER')};"
            f"border-radius:8px;color:{TXT1};font-size:12px}}"
            f"QPushButton:checked{{background:rgba(74,222,128,0.12);border-color:#4ade80;color:#4ade80}}"
        )
        inv_lay.addWidget(inv_start_btn)

        # Stats row
        self._mc_stats_lbl = QLabel("❤️ --/20   🍖 --/20   📍 --  --  --   ⭐ lvl --")
        self._mc_stats_lbl.setStyleSheet(f"font-size:11px;color:{_c('ACC2')};padding:4px 0")
        self._mc_stats_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        inv_lay.addWidget(self._mc_stats_lbl)

        # Inventory list
        self._mc_inv_list = QListWidget()
        self._mc_inv_list.setStyleSheet(
            f"QListWidget{{background:{BG3};border:1px solid {_c('BORDER')};"
            f"border-radius:8px;color:{TXT1};font-size:11px;padding:4px}}"
            f"QListWidget::item{{padding:2px 4px}}"
        )
        inv_lay.addWidget(self._mc_inv_list, 1)

        # Refresh button
        inv_ref_btn = QPushButton("🔄  Refresh Now")
        inv_ref_btn.setFixedHeight(28)
        inv_ref_btn.setStyleSheet(
            f"QPushButton{{background:{BG3};border:1px solid {_c('BORDER')};"
            f"border-radius:8px;color:{TXT1};font-size:11px}}"
            f"QPushButton:hover{{background:{BG4}}}"
        )
        inv_ref_btn.clicked.connect(lambda: self._send_mc_percent_text("%inv"))
        inv_lay.addWidget(inv_ref_btn)

        # Auto-refresh timer (only runs while tracking is on)
        self._inv_refresh_timer = QTimer(self)
        self._inv_refresh_timer.setInterval(5000)
        self._inv_refresh_timer.timeout.connect(lambda: self._send_mc_percent_text("%inv") if self._mc_brain else None)

        def _inv_toggle(checked):
            inv_start_btn.setText("⏹  Stop Tracking" if checked else "▶  Start Tracking")
            if checked:
                self._inv_refresh_timer.start()
                self._send_mc_percent_text("%status")
                self._send_mc_percent_text("%inv")
            else:
                self._inv_refresh_timer.stop()
        inv_start_btn.toggled.connect(_inv_toggle)
        dlg.finished.connect(lambda _: self._inv_refresh_timer.stop())

        tabs.addTab(tp_inv, "🎒  Inventory")

        def _save():
            mc_new = {
                "host":        e_host.text().strip(),
                "port":        e_port.value(),
                "username":    e_user.text().strip(),
                "version":     e_ver.currentText(),
                "auth":        e_auth.currentText(),
                "ws_port":     e_wsp.value(),
                "brain_url":   e_burl.text().strip(),
                "brain_key":   e_bkey.text().strip(),
                "brain_model": e_bmdl.text().strip(),
                "ai_features": {
                    "ai_hash_chat":    chk_hash.isChecked(),
                    "ai_advancements": chk_adv.isChecked(),
                    "ai_task_done":    chk_task.isChecked(),
                    "ai_events":       chk_events.isChecked(),
                },
            }
            CONFIG["minecraft"] = mc_new
            if hasattr(self, '_auto_rule_checks'):
                CONFIG["mc_auto_rules"] = {k: chk.isChecked() for k, chk in self._auto_rule_checks.items()}
            save_config()
            dlg.accept()
            self._display("*loading mods* Minecraft settings saved! [EMOTION: excited] 🎮")

        self._save_btn(dlg, lay, _save)
        dlg.show()

    # ── Message limit dialog ──────────────────────────────────────────────────
    def _msg_limit_dlg(self):
        dlg = self._dlg_base("💬 Message / Memory Limit", w=400, h=260)
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
            self._display(f"Memory limit set to {slider.value()} messages! [EMOTION: thinking] 🧠")

        self._save_btn(dlg, lay, _save)
        dlg.show()



    # ── TTS Settings dialog ───────────────────────────────────────────────────
    def _tts_settings_dlg(self):
        dlg = self._dlg_base("🔊 TTS Settings", w=480)
        lay = QVBoxLayout(dlg._content)

        hdr = QLabel("🔊  Text-to-Speech Settings")
        hdr.setStyleSheet(f"font-size:15px;font-weight:bold;color:{CYAN};padding:8px 0")
        hdr.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(hdr)

        # ── Piper voice quick-switch (only if voices exist) ───────────────────
        if PIPER_MODELS:
            vrow = QHBoxLayout(); vrow.setSpacing(8)
            vrow.addWidget(QLabel("🎤"))
            cv = self.sd.get("selected_offline_voice", "")
            vbox = QComboBox()
            for vn in sorted(PIPER_MODELS):
                vbox.addItem(vn)
                if vn == cv: vbox.setCurrentText(vn)
            vbox.setFixedHeight(30)
            def _qv_change(idx):
                vn = vbox.currentText()
                self.sd["selected_offline_voice"] = vn
                if not self.sd.get("tts_enabled"):
                    self.sd["tts_enabled"] = True; self.sd["tts_engine"] = "offline"
                persist_save(self.sd)
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
        chk_enabled.setChecked(self.sd.get("tts_enabled", False))
        chk_enabled.setStyleSheet(f"color:{TXT1};font-size:13px;font-weight:bold")
        fg.addRow(chk_enabled)

        # Lip-sync toggles
        chk_lipsync_tts = QCheckBox("🎙️  Lip-sync during TTS playback  (opens/closes mouth while speaking)")
        chk_lipsync_tts.setChecked(self.sd.get("lip_sync_tts", True))
        chk_lipsync_tts.setStyleSheet(f"color:{TXT1};font-size:12px")
        fg.addRow(chk_lipsync_tts)

        chk_lipsync_txt = QCheckBox("💬  Lip-sync during text typing  (mouth moves per word, no TTS needed)")
        chk_lipsync_txt.setChecked(self.sd.get("lip_sync_text", False))
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
        cur_eng = self.sd.get("tts_engine", "online")
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
        e_key_w, e_key = self._eye_field("Paste your ElevenLabs API key...", el.get("api_key", ""))
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

        self._field_row(fel, "API Key",  e_key_w, "elevenlabs.io → Profile → API Keys")
        self._field_row(fel, "Voice ID", e_vid,   "Voice Library → click voice → copy ID")
        self._field_row(fel, "Model",    el_model, "eleven_turbo_v2_5 = fastest + emotional")

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
            mp = get_voice_path(self.sd)
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
        cur_piper = self.sd.get("selected_offline_voice", "")
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

        self._field_row(fp, "Voice Model", piper_box, "Select which .onnx voice to use")
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
        self._field_row(fstt, "Engine", stt_eng_box)

        groq_model_box = QComboBox()
        for m in ["whisper-large-v3-turbo","whisper-large-v3","distil-whisper-large-v3-en"]:
            groq_model_box.addItem(m)
        idx = groq_model_box.findText(stt.get("groq_model","whisper-large-v3-turbo"))
        groq_model_box.setCurrentIndex(idx if idx >= 0 else 0)
        self._field_row(fstt, "Groq Model", groq_model_box)

        local_model_box = QComboBox()
        for m, desc in [("tiny","tiny"),("base","base (recommended)"),
                        ("small","small"),("medium","medium"),("large","large")]:
            local_model_box.addItem(desc, userData=m)
        cur_lm = stt.get("local_model","base")
        for i in range(local_model_box.count()):
            if local_model_box.itemData(i) == cur_lm:
                local_model_box.setCurrentIndex(i); break
        self._field_row(fstt, "Local Model", local_model_box)

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
        self._field_row(fstt, "Microphone", mic_box, "Select which mic to use for STT")

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
        self._field_row(fstt, "🎚️ Mic Gain", gain_w,
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
            self.sd["tts_enabled"]    = chk_enabled.isChecked()
            self.sd["lip_sync_tts"]   = chk_lipsync_tts.isChecked()
            self.sd["lip_sync_text"]  = chk_lipsync_txt.isChecked()
            self.sd["tts_engine"]  = engine_box.itemData(engine_box.currentIndex())
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
                self.sd["selected_offline_voice"] = sel

            # STT
            CONFIG["stt"] = {
                "engine":       stt_eng_box.itemData(stt_eng_box.currentIndex()),
                "groq_model":   groq_model_box.currentText(),
                "local_model":  local_model_box.currentData(),
                "device_index": mic_box.currentData(),
                "mic_gain":     gain_slider.value() / 10.0,
            }

            persist_save(self.sd)
            save_config()
            dlg.accept()

            eng_name = {"elevenlabs": "ElevenLabs 🎙️",
                        "online":     "edge-tts 🌐",
                        "offline":    "Piper 💾"}.get(self.sd["tts_engine"], self.sd["tts_engine"])
            state = "ON" if self.sd["tts_enabled"] else "OFF"
            self._display(f"TTS {state} — engine: {eng_name} [EMOTION: happy] 🔊")

        self._save_btn(dlg, lay, _save)
        dlg.show()

    # ── ElevenLabs settings dialog ────────────────────────────────────────────
    def _el_settings_dlg(self):
        from audio.tts_elevenlabs import list_voices, is_configured
        dlg = self._dlg_base("🎙️ ElevenLabs Voice", w=460)
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

        self._field_row(form, "API Key",  e_key,   "From elevenlabs.io → Profile → API Keys")
        self._field_row(form, "Voice ID", e_vid,   "From Voice Library — click a voice → copy ID")
        self._field_row(form, "Model",    e_model, "eleven_turbo_v2_5 = fastest + emotional")
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
            self._display("*clears throat* ElevenLabs configured! [EMOTION: happy] 🎙️")

        self._save_btn(dlg, lay, _save)
        dlg.show()

    def paintEvent(self, e): pass


# ── Entry point ───────────────────────────────────────────────────────────────
def main():
    import signal
    for d in [OUTFITS_DIR, SOUNDS_DIR, TTS_DIR, VOICES_DIR]:
        d.mkdir(exist_ok=True)
    app = QApplication(sys.argv); app.setStyle("Fusion")
    pal = QPalette()
    pal.setColor(QPalette.ColorRole.Window,     QColor(BG1))
    pal.setColor(QPalette.ColorRole.WindowText, QColor(TXT1))
    app.setPalette(pal)
    w = CompanionWindow(); w.show()
    # Save on Ctrl+C or SIGTERM so nothing is lost
    def _sig_save(sig=None, frame=None):
        try:
            w.traits = deduplicate_traits(w.traits)
            persist_save(w.sd); save_traits(w.traits)
        except Exception: pass
        QApplication.quit()
    signal.signal(signal.SIGTERM, _sig_save)
    signal.signal(signal.SIGINT,  _sig_save)
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
