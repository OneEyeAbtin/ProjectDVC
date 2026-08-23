"""
[MODULE] graphics.py
[SYSTEM] ProjectDVC — Sprite pipeline. Scans /assets/outfits for companion textures,
         runs a green-screen keyer (numpy fast-path, Qt fallback), audits texture
         coverage per outfit, and renders a procedural fallback character when no
         sprite is found on disk.
[AUTHOR] Abtin

Copyright (c) 2026 Abtin (github.com/OneEyeAbtin). All rights reserved.
This code may not be copied, modified, or distributed without permission.
"""
import time
from PyQt6.QtCore import Qt, QPoint
from PyQt6.QtGui  import QPixmap, QColor, QPainter, QImage, QBrush, QPainterPath
from core.config import OUTFITS_DIR, CONFIG
from gui.theme   import get as _tc

# Color shortcuts pulled from active theme at render time
def PURPLE(): return _tc('ACC2')
def CYAN():   return _tc('ACC3')
def PINK():   return _tc('ACC1')

ALL_EMOTIONS: set[str] = {
    "neutral","happy","sad","angry","blush","thinking","love","sleepy",
    "excited","confused","bored","annoyed","evil","eyeroll","mocking",
    "smirk","shocked","disgusted","fullbody","talking",
}

# File cache — {stem: abs_path_str}, TTL 10 s
_cache:      dict[str, str] = {}
_cache_time: float           = 0.0


def scan_outfits() -> dict[str, str]:
    global _cache, _cache_time
    if not OUTFITS_DIR.exists():
        return {}
    now = time.time()
    if _cache and (now - _cache_time) < 10:
        return _cache

    c:        dict[str, str] = {}
    prefixes: set[str]       = set()

    for f in OUTFITS_DIR.iterdir():
        if f.is_file() and f.suffix.lower() in {".png",".jpg",".jpeg",".webp",".gif",".bmp"}:
            k = f.stem.lower()
            c[k] = str(f.resolve())
            for e in ALL_EMOTIONS:
                if k.endswith(e) and len(k) > len(e):
                    prefixes.add(k[: len(k) - len(e)])

    _cache, _cache_time = c, now

    # Auto-register newly discovered prefixes into CONFIG (runtime only)
    existing = set(CONFIG["outfits"].values())
    for p in sorted(prefixes):
        if p not in existing:
            display = p.capitalize()
            if display in CONFIG["outfits"]:
                display += " Outfit"
            CONFIG["outfits"][display] = p
            print(f"[OUTFIT] Auto-detected: '{display}' (prefix: '{p}')")

    print(f"[OUTFIT] {len(c)} files | outfits: {list(CONFIG['outfits'].keys())}")
    return c


def audit_outfits() -> None:
    """Print a texture coverage report to the terminal."""
    fc      = scan_outfits()
    emos    = CONFIG.get("emotions", [])
    outfits = CONFIG.get("outfits",  {})
    print("\n" + "=" * 60 + "\n  TEXTURE AUDIT\n" + "=" * 60)
    for name, prefix in outfits.items():
        found  = [e for e in emos if (f"{prefix}{e}" if prefix else e) in fc]
        miss   = [e for e in emos if (f"{prefix}{e}" if prefix else e) not in fc]
        has_fb = (f"{prefix}fullbody" if prefix else "fullbody") in fc
        status = "OK" if not miss else "PARTIAL"
        print(f"  [{status}] {name} ('{prefix}'): {len(found)}/{len(emos)}"
              + (" +fullbody" if has_fb else ""))
        if miss:
            print(f"    Missing: {', '.join(miss)}")
    print("=" * 60 + "\n")


def remove_green_screen(pix: QPixmap, tol: int = 60) -> QPixmap:
    """Remove #00FF00 green-screen background.  Uses numpy fast-path if available."""
    img = pix.toImage().convertToFormat(QImage.Format.Format_ARGB32)
    w, h = img.width(), img.height()
    try:
        import numpy as np
        ptr = img.bits()
        ptr.setsize(h * w * 4)
        a = np.frombuffer(ptr, dtype=np.uint8).reshape((h, w, 4)).copy()
        # ARGB32 in memory is B G R A on little-endian
        b, g, r = a[:,:,0].astype(np.int16), a[:,:,1].astype(np.int16), a[:,:,2].astype(np.int16)
        mask = (g > (255 - tol)) & (r < tol) & (b < tol)
        a[mask, 3] = 0
        result = QImage(a.data, w, h, w * 4, QImage.Format.Format_ARGB32).copy()
        return QPixmap.fromImage(result)
    except Exception:
        # Pure-Qt fallback (slow for large images but always works)
        for y in range(h):
            for x in range(w):
                c = QColor(img.pixelColor(x, y))
                if c.green() > (255 - tol) and c.red() < tol and c.blue() < tol:
                    img.setPixelColor(x, y, QColor(0, 0, 0, 0))
        return QPixmap.fromImage(img)


def render_fallback(emotion: str, outfit: str, w: int = 380, h: int = 350) -> QPixmap:
    """Draw a simple placeholder character when no sprite file is found."""
    pix = QPixmap(w, h)
    pix.fill(QColor(0, 0, 0, 0))
    p = QPainter(pix)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    cx, cy = w // 2, 140

    # Emotion-tinted eye color
    eye_colors = {
        "love": "#ff6b9d", "angry": "#ff4444", "sad": "#67e8f9",
        "evil": "#44ff44", "excited": "#ffd700", "blush": "#ffb3d1",
    }
    eye_c = eye_colors.get(emotion, CYAN)

    # Hair (back layer)
    p.setBrush(QBrush(QColor(PURPLE()))); p.setPen(Qt.PenStyle.NoPen)
    p.drawEllipse(QPoint(cx, cy - 10), 56, 62)

    # Face
    p.setBrush(QBrush(QColor("#ffe4c4")))
    p.drawEllipse(QPoint(cx, cy), 44, 46)

    # Eyes
    p.setBrush(QBrush(QColor(eye_c)))
    for ex in [cx - 18, cx + 18]:
        p.drawEllipse(QPoint(ex, cy - 2), 6, 6)
    # Pupils
    p.setBrush(QBrush(QColor("#1a1025")))
    for ex in [cx - 18, cx + 18]:
        p.drawEllipse(QPoint(ex, cy - 1), 3, 3)

    # Mouth — varies by emotion
    from PyQt6.QtGui import QPen
    p.setPen(QPen(QColor("#c084fc"), 2))
    p.setBrush(Qt.BrushStyle.NoBrush)
    if emotion in ("happy", "excited", "love"):
        p.drawArc(cx - 12, cy + 18, 24, 14, 0, -180 * 16)       # smile
    elif emotion in ("sad", "angry"):
        p.drawArc(cx - 12, cy + 24, 24, 14, 0, 180 * 16)         # frown
    else:
        p.drawLine(cx - 10, cy + 22, cx + 10, cy + 22)            # neutral

    # Body
    p.setPen(Qt.PenStyle.NoPen)
    p.setBrush(QBrush(QColor(PINK())))
    body = QPainterPath()
    body.moveTo(cx - 36, cy + 50); body.lineTo(cx + 36, cy + 50)
    body.lineTo(cx + 40, cy + 160); body.lineTo(cx - 40, cy + 160)
    body.closeSubpath()
    p.drawPath(body)

    # Arms
    p.setBrush(QBrush(QColor("#ffe4c4")))
    p.drawEllipse(QPoint(cx - 50, cy + 80), 12, 30)
    p.drawEllipse(QPoint(cx + 50, cy + 80), 12, 30)

    p.end()
    return pix
