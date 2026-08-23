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

from core.constants import (_GREETS, _DEAD_MSGS, _DEEP_MAP, _EMO_REMAP,
                            _BRAIN_ICONS, _BRAIN_NAMES, _PERSONA_GROUPS, _INTERACT_MENU)

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
        from gui.styles import apply_theme
        apply_theme(self)
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
        """Update the active-task strip below the MC bar AND cache state."""
        # Cache so the MC settings dialog can populate immediately on open
        self._last_task_label  = label
        self._last_task_active = active
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
            # Guard: test if the C++ object is still alive (dialog may have closed)
            try: lw.count()
            except RuntimeError:
                # Dialog was closed — C++ object deleted. Clear the reference.
                del self._task_queue_list_widget
                return
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
        cmd_word = text[1:].split()[0].lower() if len(text) > 1 else ""

        # ── Stop/clear ALWAYS bypass the queue and go straight to bot.js ─────
        # Enqueuing %stop behind the current task defeats its purpose entirely.
        _BYPASS = {"stop", "cancel", "halt", "clear", "clearqueue"}
        if cmd_word in _BYPASS:
            # Also abort the Python-side queue immediately
            if hasattr(self, 'task_queue'):
                self.task_queue.abort_all("user_stop")
            if hasattr(self, '_mc_brain') and self._mc_brain:
                self._mc_brain.send_cmd("text", {"text": text})
            else:
                self._mc_console_log("⚠ Bot not connected", color="#ff9800")
            return

        # ── All other commands go directly to bot.js — no Python queue ───────
        # The Python TaskQueue only handles tasks queued from the Python GUI
        # (task_combo add button). % commands typed by the user go straight
        # to bot.js which has its own task_runner queue. Routing them through
        # the Python queue caused stop to wait behind the running task, and
        # added an extra queue layer that doubled state divergence.
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
        from gui.dialogs.stats_dialog import show_stats_dialog
        show_stats_dialog(self)


    # ── Unified Settings dialog ────────────────────────────────────────────────
    def _all_settings_dlg(self):
        from gui.dialogs.settings_dialog import show_all_settings
        show_all_settings(self)


    def _mem_dlg(self):
        from gui.dialogs.memory_dialog import show_memory_dialog
        show_memory_dialog(self)




    # ── Theme picker dialog ───────────────────────────────────────────────────
    def _theme_picker_dlg(self):
        from gui.dialogs.theme_picker import show_theme_picker
        show_theme_picker(self)



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
        from gui.dialogs.ai_settings_dialog import show_ai_settings
        show_ai_settings(self)


    # ── Minecraft Settings dialog ─────────────────────────────────────────────
    def _mc_settings_dlg(self):
        from gui.dialogs.mc_settings_dialog import show_mc_settings
        show_mc_settings(self)


    # ── Message limit dialog ──────────────────────────────────────────────────
    def _msg_limit_dlg(self):
        from gui.dialogs.msg_limit_dialog import show_msg_limit
        show_msg_limit(self)




    # ── TTS Settings dialog ───────────────────────────────────────────────────
    def _tts_settings_dlg(self):
        from gui.dialogs.tts_settings_dialog import show_tts_settings
        show_tts_settings(self)


    # ── ElevenLabs settings dialog ────────────────────────────────────────────
    def _el_settings_dlg(self):
        from gui.dialogs.el_settings_dialog import show_el_settings
        show_el_settings(self)


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
