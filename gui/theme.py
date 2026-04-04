"""
[MODULE] theme.py
[SYSTEM] ProjectDVC — Color genome engine. Defines the 9 built-in palettes that
         bleed through every pixel of the UI. Mutates active theme at runtime;
         all consumers pull live color via get() or the typed accessors.
         Theme state persisted in dvc_profile.json under "theme".
[AUTHOR] Abtin
"""
from __future__ import annotations

# ── Theme definitions ─────────────────────────────────────────────────────────
# Each theme is a dict of named color roles.
# BG1 = deepest bg, BG2 = panel, BG3 = raised element
# ACC1 = primary accent, ACC2 = secondary accent, ACC3 = highlight
# TXT1 = primary text, TXT2 = muted text
# BORDER = border rgba string
# GRAD_START/END = window gradient stops
# TB_BG = top bar background rgba

THEMES: dict[str, dict] = {

    "Midnight Sakura": {
        "label":       "🌸 Midnight Sakura",
        "BG1":         "#0d0816",
        "BG2":         "#1a1025",
        "BG3":         "#2d1f3d",
        "BG4":         "#3d2a54",
        "ACC1":        "#ff6b9d",
        "ACC2":        "#c084fc",
        "ACC3":        "#67e8f9",
        "TXT1":        "#f0e6ff",
        "TXT2":        "#b8a5d4",
        "BORDER":      "rgba(192,132,252,0.25)",
        "BORDER2":     "rgba(255,107,157,0.2)",
        "GRAD_START":  "#0d0816",
        "GRAD_END":    "#110d1a",
        "TB_BG":       "rgba(26,16,37,230)",
        "BTN_GRAD":    "qlineargradient(x1:0,y1:0,x2:1,y2:1,stop:0 #ff6b9d,stop:1 #c084fc)",
        "PROGRESS":    "qlineargradient(x1:0,y1:0,x2:1,y2:0,stop:0 #ff6b9d,stop:0.5 #c084fc,stop:1 #67e8f9)",
        "GLOW":        "rgba(192,132,252,0.15)",
    },

    "Crimson Abyss": {
        "label":       "🩸 Crimson Abyss",
        "BG1":         "#0a0608",
        "BG2":         "#160a0e",
        "BG3":         "#261218",
        "BG4":         "#361820",
        "ACC1":        "#ff2d55",
        "ACC2":        "#ff6b35",
        "ACC3":        "#ffd60a",
        "TXT1":        "#ffe8e8",
        "TXT2":        "#cc9999",
        "BORDER":      "rgba(255,45,85,0.25)",
        "BORDER2":     "rgba(255,107,53,0.2)",
        "GRAD_START":  "#0a0608",
        "GRAD_END":    "#0f0509",
        "TB_BG":       "rgba(22,10,14,230)",
        "BTN_GRAD":    "qlineargradient(x1:0,y1:0,x2:1,y2:1,stop:0 #ff2d55,stop:1 #ff6b35)",
        "PROGRESS":    "qlineargradient(x1:0,y1:0,x2:1,y2:0,stop:0 #ff2d55,stop:0.5 #ff6b35,stop:1 #ffd60a)",
        "GLOW":        "rgba(255,45,85,0.15)",
    },

    "Ocean Dream": {
        "label":       "🌊 Ocean Dream",
        "BG1":         "#060d14",
        "BG2":         "#0a1628",
        "BG3":         "#102038",
        "BG4":         "#162c4a",
        "ACC1":        "#00d4ff",
        "ACC2":        "#0099ff",
        "ACC3":        "#7df9ff",
        "TXT1":        "#e0f4ff",
        "TXT2":        "#7ab8d4",
        "BORDER":      "rgba(0,212,255,0.2)",
        "BORDER2":     "rgba(0,153,255,0.2)",
        "GRAD_START":  "#060d14",
        "GRAD_END":    "#080f18",
        "TB_BG":       "rgba(10,22,40,230)",
        "BTN_GRAD":    "qlineargradient(x1:0,y1:0,x2:1,y2:1,stop:0 #00d4ff,stop:1 #0066cc)",
        "PROGRESS":    "qlineargradient(x1:0,y1:0,x2:1,y2:0,stop:0 #0099ff,stop:0.5 #00d4ff,stop:1 #7df9ff)",
        "GLOW":        "rgba(0,212,255,0.12)",
    },

    "Forest Dusk": {
        "label":       "🌿 Forest Dusk",
        "BG1":         "#070c08",
        "BG2":         "#0e1a10",
        "BG3":         "#172a1a",
        "BG4":         "#1f3824",
        "ACC1":        "#4ade80",
        "ACC2":        "#86efac",
        "ACC3":        "#fbbf24",
        "TXT1":        "#e8f5e0",
        "TXT2":        "#8aaa90",
        "BORDER":      "rgba(74,222,128,0.2)",
        "BORDER2":     "rgba(251,191,36,0.2)",
        "GRAD_START":  "#070c08",
        "GRAD_END":    "#090e0a",
        "TB_BG":       "rgba(14,26,16,230)",
        "BTN_GRAD":    "qlineargradient(x1:0,y1:0,x2:1,y2:1,stop:0 #4ade80,stop:1 #16a34a)",
        "PROGRESS":    "qlineargradient(x1:0,y1:0,x2:1,y2:0,stop:0 #4ade80,stop:0.5 #86efac,stop:1 #fbbf24)",
        "GLOW":        "rgba(74,222,128,0.12)",
    },

    "Synthwave": {
        "label":       "🎵 Synthwave",
        "BG1":         "#08060f",
        "BG2":         "#12091e",
        "BG3":         "#1e0f32",
        "BG4":         "#2a1545",
        "ACC1":        "#f72585",
        "ACC2":        "#7209b7",
        "ACC3":        "#4cc9f0",
        "TXT1":        "#fce4ff",
        "TXT2":        "#b07cc6",
        "BORDER":      "rgba(247,37,133,0.25)",
        "BORDER2":     "rgba(76,201,240,0.2)",
        "GRAD_START":  "#08060f",
        "GRAD_END":    "#0b0814",
        "TB_BG":       "rgba(18,9,30,230)",
        "BTN_GRAD":    "qlineargradient(x1:0,y1:0,x2:1,y2:1,stop:0 #f72585,stop:1 #7209b7)",
        "PROGRESS":    "qlineargradient(x1:0,y1:0,x2:1,y2:0,stop:0 #f72585,stop:0.5 #7209b7,stop:1 #4cc9f0)",
        "GLOW":        "rgba(247,37,133,0.15)",
    },

    "Arctic Ghost": {
        "label":       "🧊 Arctic Ghost",
        "BG1":         "#070a0f",
        "BG2":         "#0e1520",
        "BG3":         "#162030",
        "BG4":         "#1e2c40",
        "ACC1":        "#a8d8ff",
        "ACC2":        "#6eb5ff",
        "ACC3":        "#ffffff",
        "TXT1":        "#eef4ff",
        "TXT2":        "#8aaccc",
        "BORDER":      "rgba(168,216,255,0.18)",
        "BORDER2":     "rgba(110,181,255,0.15)",
        "GRAD_START":  "#070a0f",
        "GRAD_END":    "#090c12",
        "TB_BG":       "rgba(14,21,32,230)",
        "BTN_GRAD":    "qlineargradient(x1:0,y1:0,x2:1,y2:1,stop:0 #a8d8ff,stop:1 #4a90c4)",
        "PROGRESS":    "qlineargradient(x1:0,y1:0,x2:1,y2:0,stop:0 #6eb5ff,stop:0.5 #a8d8ff,stop:1 #ffffff)",
        "GLOW":        "rgba(168,216,255,0.10)",
    },

    "Darkwave": {
        "label":       "🩸 Darkwave",
        "BG1":         "#0a0005",
        "BG2":         "#150009",
        "BG3":         "#220010",
        "BG4":         "#30001a",
        "ACC1":        "#cc0033",
        "ACC2":        "#880022",
        "ACC3":        "#ff4466",
        "TXT1":        "#ffe0e8",
        "TXT2":        "#996677",
        "BORDER":      "rgba(204,0,51,0.30)",
        "BORDER2":     "rgba(255,68,102,0.20)",
        "GRAD_START":  "#0a0005",
        "GRAD_END":    "#0d0007",
        "TB_BG":       "rgba(21,0,9,220)",
        "BTN_GRAD":    "qlineargradient(x1:0,y1:0,x2:1,y2:1,stop:0 #cc0033,stop:1 #550011)",
        "PROGRESS":    "qlineargradient(x1:0,y1:0,x2:1,y2:0,stop:0 #880022,stop:0.5 #cc0033,stop:1 #ff4466)",
        "GLOW":        "rgba(204,0,51,0.18)",
    },

    "Matrix": {
        "label":       "💻 Matrix",
        "BG1":         "#000300",
        "BG2":         "#000a00",
        "BG3":         "#001200",
        "BG4":         "#001e00",
        "ACC1":        "#00ff41",
        "ACC2":        "#008f11",
        "ACC3":        "#00ff41",
        "TXT1":        "#ccffcc",
        "TXT2":        "#447744",
        "BORDER":      "rgba(0,255,65,0.22)",
        "BORDER2":     "rgba(0,143,17,0.18)",
        "GRAD_START":  "#000300",
        "GRAD_END":    "#000500",
        "TB_BG":       "rgba(0,10,0,230)",
        "BTN_GRAD":    "qlineargradient(x1:0,y1:0,x2:1,y2:1,stop:0 #00ff41,stop:1 #005511)",
        "PROGRESS":    "qlineargradient(x1:0,y1:0,x2:1,y2:0,stop:0 #008f11,stop:0.5 #00ff41,stop:1 #aaffaa)",
        "GLOW":        "rgba(0,255,65,0.13)",
    },

    "Ethereal": {
        "label":       "🕊️ Ethereal",
        "BG1":         "#f0f4ff",
        "BG2":         "#e8eeff",
        "BG3":         "#dde5ff",
        "BG4":         "#c7d4ff",
        "ACC1":        "#fbbf24",
        "ACC2":        "#93c5fd",
        "ACC3":        "#ffffff",
        "TXT1":        "#1e1b4b",
        "TXT2":        "#6366f1",
        "BORDER":      "rgba(147,197,253,0.50)",
        "BORDER2":     "rgba(251,191,36,0.40)",
        "GRAD_START":  "#f0f4ff",
        "GRAD_END":    "#eef2ff",
        "TB_BG":       "rgba(232,238,255,240)",
        "BTN_GRAD":    "qlineargradient(x1:0,y1:0,x2:1,y2:1,stop:0 #fbbf24,stop:1 #93c5fd)",
        "PROGRESS":    "qlineargradient(x1:0,y1:0,x2:1,y2:0,stop:0 #93c5fd,stop:0.5 #fbbf24,stop:1 #ffffff)",
        "GLOW":        "rgba(147,197,253,0.30)",
    },
    
}

THEME_NAMES = list(THEMES.keys())
DEFAULT_THEME = "Midnight Sakura"

# ── Active theme (module-level, mutated at runtime) ───────────────────────────
_active: dict = THEMES[DEFAULT_THEME].copy()

def set_theme(name: str) -> None:
    global _active
    _active = THEMES.get(name, THEMES[DEFAULT_THEME]).copy()

def get(key: str) -> str:
    return _active.get(key, "")

# Convenience accessors — used throughout the app
def BG1()   -> str: return _active["BG1"]
def BG2()   -> str: return _active["BG2"]
def BG3()   -> str: return _active["BG3"]
def BG4()   -> str: return _active["BG4"]
def ACC1()  -> str: return _active["ACC1"]
def ACC2()  -> str: return _active["ACC2"]
def ACC3()  -> str: return _active["ACC3"]
def TXT1()  -> str: return _active["TXT1"]
def TXT2()  -> str: return _active["TXT2"]

def build_stylesheet() -> str:
    t = _active
    return f"""
QWidget{{
    background:transparent;
    color:{t['TXT1']};
    font-family:'Segoe UI',Arial,sans-serif;
}}
QLineEdit{{
    background:{t['BG3']};
    border:1px solid {t['BORDER']};
    border-radius:12px;
    padding:10px 14px;
    font-size:14px;
    color:{t['TXT1']};
    selection-background-color:{t['ACC2']};
}}
QLineEdit:focus{{
    border:1px solid {t['ACC1']};
    background:{t['BG4']};
}}
QLineEdit::placeholder{{
    color:{t['TXT2']};
}}
QPushButton#sendBtn{{
    background:{t['BTN_GRAD']};
    border:none;
    border-radius:12px;
    font-size:18px;
    min-width:44px; min-height:44px;
    max-width:44px; max-height:44px;
}}
QPushButton#sendBtn:hover{{
    opacity:0.85;
}}
QPushButton#micBtn{{
    background:{t['BG3']};
    border:1px solid {t['BORDER']};
    border-radius:12px;
    font-size:18px;
    min-width:44px; min-height:44px;
    max-width:44px; max-height:44px;
    color:{t['TXT1']};
}}
QPushButton#micBtn:hover{{
    border:1px solid {t['ACC1']};
    background:{t['BG4']};
}}
QProgressBar{{
    background:{t['BG3']};
    border:none;
    border-radius:3px;
    height:4px;
}}
QProgressBar::chunk{{
    background:{t['PROGRESS']};
    border-radius:3px;
}}
QMenu{{
    background:{t['BG2']};
    border:1px solid {t['BORDER']};
    border-radius:10px;
    padding:6px 0;
    font-size:13px;
    color:{t['TXT1']};
}}
QMenu::item{{
    padding:9px 28px 9px 18px;
    border-radius:6px;
    margin:1px 4px;
}}
QMenu::item:selected{{
    background:{t['GLOW']};
    color:{t['ACC1']};
}}
QMenu::separator{{
    height:1px;
    background:{t['BORDER']};
    margin:4px 8px;
}}
QScrollArea{{
    background:transparent;
    border:none;
}}
QScrollBar:vertical{{
    background:{t['BG2']};
    width:6px;
    border-radius:3px;
}}
QScrollBar::handle:vertical{{
    background:{t['ACC2']};
    border-radius:3px;
    min-height:20px;
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical{{
    height:0px;
}}
QComboBox{{
    background:{t['BG3']};
    border:1px solid {t['BORDER']};
    border-radius:8px;
    padding:5px 10px;
    color:{t['TXT1']};
    font-size:12px;
    min-height:28px;
}}
QComboBox:hover{{
    border:1px solid {t['ACC2']};
}}
QComboBox:focus{{
    border:1px solid {t['ACC1']};
}}
QComboBox::drop-down{{
    border:none;
    width:20px;
}}
QComboBox::down-arrow{{
    image:none;
    border-left:5px solid transparent;
    border-right:5px solid transparent;
    border-top:6px solid {t['ACC2']};
    margin-right:6px;
}}
QComboBox QAbstractItemView{{
    background:{t['BG2']};
    border:1px solid {t['BORDER']};
    border-radius:8px;
    color:{t['TXT1']};
    selection-background-color:{t['GLOW']};
    selection-color:{t['ACC1']};
    padding:4px;
    outline:0;
}}
QComboBox QAbstractItemView::item{{
    padding:6px 12px;
    border-radius:4px;
    min-height:24px;
}}
QComboBox QAbstractItemView::item:hover{{
    background:{t['BG4']};
    color:{t['ACC1']};
}}
QCheckBox{{
    color:{t['TXT1']};
    font-size:12px;
    spacing:8px;
}}
QCheckBox::indicator{{
    width:16px;
    height:16px;
    border:1px solid {t['BORDER']};
    border-radius:4px;
    background:{t['BG3']};
}}
QCheckBox::indicator:checked{{
    background:{t['ACC2']};
    border-color:{t['ACC2']};
}}
QSlider::groove:horizontal{{
    background:{t['BG3']};
    height:6px;
    border-radius:3px;
}}
QSlider::handle:horizontal{{
    background:{t['ACC1']};
    border:none;
    width:14px;
    height:14px;
    border-radius:7px;
    margin:-4px 0;
}}
QSlider::sub-page:horizontal{{
    background:{t['ACC2']};
    border-radius:3px;
}}
QSpinBox{{
    background:{t['BG3']};
    border:1px solid {t['BORDER']};
    border-radius:8px;
    padding:4px 8px;
    color:{t['TXT1']};
    font-size:12px;
}}
QSpinBox::up-button, QSpinBox::down-button{{
    background:{t['BG4']};
    border:none;
    width:18px;
    border-radius:4px;
}}
"""
