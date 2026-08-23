"""Theme application helpers — applies the active TH._active palette to every
widget owned by a CompanionWindow.  Extracted from core/main.py.
"""

from PyQt6.QtWidgets import QFrame
import gui.theme as TH


def apply_theme(window):
    """Re-apply the current theme to every styled widget in *window*."""
    t = TH._active

    window.setStyleSheet(TH.build_stylesheet())

    # Window container gradient
    window.ctr.setStyleSheet(
        f"QFrame#ctr{{"
        f"background:qlineargradient(x1:0,y1:0,x2:0,y2:1,"
        f"stop:0 {t['BG1']},stop:1 {t['GRAD_END']});"
        f"border:1.5px solid {t['BORDER']};"
        f"border-radius:18px;"
        f"}}"
    )

    # Top bar
    if hasattr(window, "stack") and window.stack.count() > 1:
        mp = window.stack.widget(1)
        tb = mp.findChild(QFrame, "topbar")
        if tb:
            tb.setStyleSheet(
                f"QFrame#topbar{{"
                f"background:{t['TB_BG']};"
                f"border-bottom:1px solid {t['BORDER']};"
                f"border-top-left-radius:16px;"
                f"border-top-right-radius:16px;"
                f"}}"
            )
        div = mp.findChild(QFrame, "divider")
        if div:
            div.setStyleSheet(f"QFrame#divider{{background:{t['BORDER']}}}")

        ab = mp.findChild(QFrame, "accentBar")
        if ab:
            ab.setStyleSheet(
                f"QFrame#accentBar{{background:qlineargradient(x1:0,y1:0,x2:1,y2:0,"
                f"stop:0 {t['ACC1']},stop:0.5 {t['ACC2']},stop:1 {t['ACC3']});}}"
            )

    # Badges
    if hasattr(window, "emo_badge"):
        window.emo_badge.setStyleSheet(
            f"background:rgba(0,0,0,0.55);border:1px solid {t['BORDER']};"
            f"border-radius:10px;padding:2px 9px;font-size:9px;"
            f"color:{t['ACC3']};font-weight:bold;letter-spacing:1px"
        )
    if hasattr(window, "out_badge"):
        window.out_badge.setStyleSheet(
            f"background:rgba(0,0,0,0.55);border:1px solid {t['BORDER2']};"
            f"border-radius:10px;padding:2px 9px;font-size:9px;"
            f"color:{t['ACC1']};font-weight:bold;letter-spacing:1px"
        )

    # Bubble
    if hasattr(window, "bubble"):
        window.bubble.setStyleSheet(
            f"font-size:14px;line-height:1.5;color:{t['TXT1']};"
            f"padding:2px 0;"
        )

    # MC button default style
    if hasattr(window, "mc_btn"):
        window.mc_btn.setStyleSheet(
            f"QPushButton{{background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.25);"
            f"border-radius:6px;font-size:14px;color:#4ade80}}"
            f"QPushButton:hover{{background:rgba(74,222,128,0.22)}}"
        )

    # MC control bar
    if hasattr(window, "_mc_bar"):
        window._mc_bar.setStyleSheet(
            f"QFrame#mcBar{{background:{t['BG2']};border-bottom:1px solid {t['BORDER']}}}"
        )
    if hasattr(window, "_mc_btn_follow"):
        _mc_btn_ss = (
            f"QPushButton{{background:{t['BG3']};border:1px solid {t['BORDER']};"
            f"border-radius:7px;padding:0 10px;font-size:11px;color:{t['TXT2']}}}"
            f"QPushButton:checked{{background:rgba(74,222,128,0.18);border-color:#4ade80;"
            f"color:#4ade80;font-weight:bold}}"
            f"QPushButton:hover{{border-color:{t['ACC1']};color:{t['ACC1']}}}"
        )
        window._mc_btn_follow.setStyleSheet(_mc_btn_ss)
        if hasattr(window, "_mc_btn_task"):
            window._mc_btn_task.setStyleSheet(_mc_btn_ss)
    if hasattr(window, "_mc_cmd_inp"):
        window._mc_cmd_inp.setStyleSheet(
            f"QLineEdit{{background:{t['BG3']};border:1px solid {t['BORDER']};"
            f"border-radius:7px;padding:2px 8px;font-size:11px;color:{t['TXT1']}}}"
            f"QLineEdit:focus{{border-color:{t['ACC1']}}}"
        )

    # Brain label
    if hasattr(window, "brain_lbl"):
        window.brain_lbl.setStyleSheet(f"font-size:13px;color:{t['TXT2']}")

    # Name label
    if hasattr(window, "name_lbl"):
        window.name_lbl.setStyleSheet(
            f"font-size:13px;font-weight:bold;letter-spacing:3px;color:{t['ACC3']}"
        )

    # Bottom tab toggle buttons
    if hasattr(window, '_tab_chat_btn'):
        for btn in [window._tab_chat_btn, window._tab_con_btn]:
            btn.setStyleSheet(
                f"QPushButton{{background:{t['BG3']};border:1px solid rgba(255,255,255,0.08);"
                f"border-radius:6px;padding:0 10px;font-size:10px;color:{t['TXT2']}}}"
                f"QPushButton:checked{{background:{t['ACC2']};border-color:{t['ACC2']};"
                f"color:white;font-weight:bold}}"
                f"QPushButton:hover{{border-color:{t['ACC1']};color:{t['ACC1']}}}"
            )
    if hasattr(window, '_main_con_log'):
        window._main_con_log.setStyleSheet(
            f"QTextEdit{{background:{t['BG1']};color:{t['TXT2']};"
            f"border:none;font-family:'Courier New',monospace;font-size:10px;padding:4px}}"
        )
    if hasattr(window, '_main_con_inp'):
        window._main_con_inp.setStyleSheet(
            f"QLineEdit{{background:{t['BG3']};border:1px solid {t['BORDER']};"
            f"border-radius:9px;padding:0 12px;color:{t['TXT1']};font-size:12px}}"
            f"QLineEdit:focus{{border-color:{t['ACC1']}}}"
        )

    # Radar and Inventory panels
    for panel_attr in ('_radar_panel_widget', '_inv_panel_widget'):
        w = getattr(window, panel_attr, None)
        if w:
            w.setStyleSheet(f"QWidget{{background:{t['BG2']}}}")

    # Tab toggle buttons for radar/inv
    if hasattr(window, '_tab_radar_btn') and hasattr(window, '_tab_inv_btn'):
        for btn in [window._tab_radar_btn, window._tab_inv_btn]:
            btn.setStyleSheet(
                f"QPushButton{{background:{t['BG3']};border:1px solid rgba(255,255,255,0.08);"
                f"border-radius:6px;padding:0 10px;font-size:10px;color:{t['TXT2']}}}"
                f"QPushButton:checked{{background:{t['ACC2']};border-color:{t['ACC2']};"
                f"color:white;font-weight:bold}}"
                f"QPushButton:hover{{border-color:{t['ACC1']};color:{t['ACC1']}}}"
            )

    # Name label (duplicate guard — already done above, kept minimal)
    if hasattr(window, "name_lbl"):
        window.name_lbl.setStyleSheet(
            f"font-size:13px;font-weight:bold;letter-spacing:3px;color:{t['ACC3']}"
        )

    # Setup page button
    if hasattr(window, "s_btn"):
        window.s_btn.setStyleSheet(
            f"QPushButton{{background:{t['BTN_GRAD']};border:none;border-radius:12px;"
            f"font-size:14px;font-weight:bold;color:white;letter-spacing:1px}}"
            f"QPushButton:hover{{opacity:0.9}}"
        )
    if hasattr(window, "s_q"):
        window.s_q.setStyleSheet(
            f"font-size:16px;font-weight:600;color:{t['TXT1']};"
            f"min-height:56px;padding:8px 0 16px"
        )
    if hasattr(window, "s_lbl"):
        window.s_lbl.setStyleSheet(
            f"font-size:10px;letter-spacing:2px;color:{t['TXT2']};padding-top:6px"
        )
