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
from audio.audio import play_sfx
def show_mc_settings(win):
    dlg = win._dlg_base("🎮 Minecraft Settings", w=460)
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

    win._field_row(fs, "Server IP",      e_host, "Server hostname or IP address")
    win._field_row(fs, "Port",           e_port, "Default: 25565")
    win._field_row(fs, "Bot Username",   e_user, "Name shown in-game")
    win._field_row(fs, "MC Version",     e_ver,  "Must match your server — type any version e.g. 1.21.10")
    win._field_row(fs, "Auth Mode",      e_auth, "offline = cracked, microsoft = premium account")
    win._field_row(fs, "WS Bridge Port", e_wsp,  "Internal port Python↔drone.bot.js use (don't change unless conflict)")
    tabs.addTab(tp_srv, "🖥  Server")

    # ── Tab: Minecraft brain (100B model) ─────────────────────────────────
    tp_br  = QWidget(); fb = QFormLayout(tp_br); fb.setSpacing(10); fb.setContentsMargins(16,16,16,8)

    e_burl = QLineEdit(mc.get("brain_url",   "https://api.openai.com/v1/chat/completions"))
    e_bkey_w, e_bkey = win._eye_field("Minecraft brain API key", mc.get("brain_key",""))
    e_bmdl = QLineEdit(mc.get("brain_model", ""))

    win._field_row(fb, "Brain URL",   e_burl, "API endpoint for the Minecraft brain model")
    win._field_row(fb, "Brain Key",   e_bkey_w, "API key for the Minecraft brain model")
    win._field_row(fb, "Brain Model", e_bmdl, "e.g. openai/gpt-oss-120b, llama-3.3-70b-versatile")

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
    if hasattr(win, '_mc_console_buf'):
        for line, color in win._mc_console_buf[-200:]:
            con_log.append(f'<span style="color:{color};">{line}</span>')
    con_log.verticalScrollBar().setValue(con_log.verticalScrollBar().maximum())
    con_lay.addWidget(con_log, 1)

    # Live update: connect a slot so new log lines appear while dialog is open
    def _append(line, color):
        con_log.append(f'<span style="color:{color};">{line}</span>')
        con_log.verticalScrollBar().setValue(con_log.verticalScrollBar().maximum())
    win._mc_console_live = _append   # stored so _mc_console_log can call it

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
        win._mc_console_log(f"→ {text}", color=CYAN)
        if text.startswith('%'):
            win._send_mc_percent_text(text)
        else:
            win._mc_send_cmd("chat", {"message": text})
    con_inp.returnPressed.connect(_con_send)
    con_send_btn.clicked.connect(_con_send)
    con_inp_row.addWidget(con_inp, 1); con_inp_row.addWidget(con_send_btn)
    con_inp_w = QWidget(); con_inp_w.setLayout(con_inp_row)
    con_lay.addWidget(con_inp_w)

    # Clear live reference when dialog closes
    dlg.finished.connect(lambda _: setattr(win, '_mc_console_live', None))

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
    win._task_queue_list_widget = QListWidget()
    win._task_queue_list_widget.setFixedHeight(80)
    win._task_queue_list_widget.setStyleSheet(
        f"QListWidget{{background:{BG3};border:1px solid {_c('BORDER')};"
        f"border-radius:8px;color:{TXT1};font-size:11px;padding:2px}}"
        f"QListWidget::item{{padding:2px 4px;border-radius:4px}}"
        f"QListWidget::item:selected{{background:{_c('GLOW')}}}"
    )
    tlay.addWidget(win._task_queue_list_widget)
    # Populate immediately with whatever is already running
    win._mc_update_task_list_widget(
        getattr(win, '_last_task_label', ''),
        getattr(win, '_last_task_active', False)
    )

    # Stop All + Follow buttons only
    stop_row = QHBoxLayout(); stop_row.setSpacing(6)
    def _mk_stop_btn(text, cmd, color):
        b = QPushButton(text); b.setFixedHeight(28)
        b.setStyleSheet(
            f"QPushButton{{background:{color};border:none;border-radius:8px;"
            f"font-size:11px;font-weight:bold;color:white;padding:0 10px}}"
            f"QPushButton:hover{{opacity:0.85}}"
        )
        b.clicked.connect(lambda: win._send_mc_percent_text(cmd))
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
        win._send_mc_percent_text(cmd)
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
    win._auto_rule_checks = {}
    saved_rules = CONFIG.get("mc_auto_rules", {})
    for key, label in rules:
        chk = QCheckBox(label)
        chk.setChecked(saved_rules.get(key, key=="collect_on_death"))
        chk.setStyleSheet(f"color:{TXT1};font-size:11px")
        tlay.addWidget(chk)
        win._auto_rule_checks[key] = chk

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
            chip.clicked.connect(lambda _, c=cmd: win._send_mc_percent_text(c))
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
    _rmc_conn = win._mc_bridge.sig_radar.connect(
        lambda ents: rmc_radar.update_entities(ents)
    )
    dlg.finished.connect(lambda _: win._mc_bridge.sig_radar.disconnect(_rmc_conn))

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
    win._mc_stats_lbl = QLabel("❤️ --/20   🍖 --/20   📍 --  --  --   ⭐ lvl --")
    win._mc_stats_lbl.setStyleSheet(f"font-size:11px;color:{_c('ACC2')};padding:4px 0")
    win._mc_stats_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
    inv_lay.addWidget(win._mc_stats_lbl)

    # Inventory list
    win._mc_inv_list = QListWidget()
    win._mc_inv_list.setStyleSheet(
        f"QListWidget{{background:{BG3};border:1px solid {_c('BORDER')};"
        f"border-radius:8px;color:{TXT1};font-size:11px;padding:4px}}"
        f"QListWidget::item{{padding:2px 4px}}"
    )
    inv_lay.addWidget(win._mc_inv_list, 1)

    # Refresh button
    inv_ref_btn = QPushButton("🔄  Refresh Now")
    inv_ref_btn.setFixedHeight(28)
    inv_ref_btn.setStyleSheet(
        f"QPushButton{{background:{BG3};border:1px solid {_c('BORDER')};"
        f"border-radius:8px;color:{TXT1};font-size:11px}}"
        f"QPushButton:hover{{background:{BG4}}}"
    )
    inv_ref_btn.clicked.connect(lambda: win._send_mc_percent_text("%inv"))
    inv_lay.addWidget(inv_ref_btn)

    # Auto-refresh timer (only runs while tracking is on)
    win._inv_refresh_timer = QTimer(win)
    win._inv_refresh_timer.setInterval(5000)
    win._inv_refresh_timer.timeout.connect(lambda: win._send_mc_percent_text("%inv") if win._mc_brain else None)

    def _inv_toggle(checked):
        inv_start_btn.setText("⏹  Stop Tracking" if checked else "▶  Start Tracking")
        if checked:
            win._inv_refresh_timer.start()
            win._send_mc_percent_text("%status")
            win._send_mc_percent_text("%inv")
        else:
            win._inv_refresh_timer.stop()
    inv_start_btn.toggled.connect(_inv_toggle)
    dlg.finished.connect(lambda _: win._inv_refresh_timer.stop())

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
        if hasattr(win, '_auto_rule_checks'):
            CONFIG["mc_auto_rules"] = {k: chk.isChecked() for k, chk in win._auto_rule_checks.items()}
        save_config()
        dlg.accept()
        win._display("*loading mods* Minecraft settings saved! [EMOTION: excited] 🎮")

    win._save_btn(dlg, lay, _save)
    dlg.show()
