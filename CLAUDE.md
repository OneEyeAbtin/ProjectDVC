# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Complete Project Map

```
ProjectDVC/
├── ProjectDVC.bat                  # Main launcher — starts Python GUI + Node drone
├── dvc_profile.json                # Central config (API keys, persona, stats, emotions, theme, all settings)
├── traits.txt                      # Session-scoped learned traits (capped at 30, deduplicated)
├── README.md                       # Full project documentation
├── AGENTS.md                       # Agent instructions / project overview
├── .gitignore
│
├── core/                           # Python — Central Nervous System
│   ├── main.py                     # CompanionWindow (PyQt6 app), all dialogs, emotion engine, UI routing, MC bridge signals
│   ├── config.py                   # Global CONFIG dict, paths (BASE, OUTFITS_DIR, SOUNDS_DIR, TTS_DIR, VOICES_DIR), load/save
│   ├── constants.py                # _GREETS, _DEAD_MSGS, _DEEP_MAP, _EMO_REMAP, _BRAIN_ICONS, _BRAIN_NAMES, _PERSONA_GROUPS, _INTERACT_MENU
│   ├── memory.py                   # Tiered memory: permanent_facts.json + traits.txt + session_cache.json, dedup, compression, prompt builder
│   ├── save.py                     # Save data I/O layer — load_save(), persist_save(), load_traits(), save_traits()
│   ├── workers.py                  # AIWorker (QThread) — fires OpenAI-compatible API requests off main thread
│   ├── mc_brain.py                 # WebSocket client → bot.js bridge, local response pools (zero-latency), AI feature toggles
│   ├── mc_tasks.py                 # TaskQueue + Task builders (mine, goto, follow, chat, stop, status, etc.), thread-safe queue
│   └── run.py                      # Entry point helper (optional alternate launcher)
│
├── gui/                            # Python — Visual Cortex
│   ├── graphics.py                 # Sprite pipeline: scan_outfits(), green-screen keyer (#00FF00 removal), fallback renderer
│   ├── theme.py                    # 9 color palettes (THEMES dict), active theme state (TH._active), color accessors, stylesheet builder
│   ├── styles.py                   # Theme application helpers — apply_theme() for CompanionWindow widgets
│   ├── run.py                      # GUI-only entry point helper
│   └── dialogs/                    # All settings/interaction popups (non-modal, use .show() not .exec())
│       ├── settings_dialog.py      # Unified Settings dialog (General tab)
│       ├── ai_settings_dialog.py   # AI/API settings (Online + Local + Minecraft Brain endpoints)
│       ├── el_settings_dialog.py   # ElevenLabs API settings (key, voice ID, model)
│       ├── tts_settings_dialog.py  # TTS Settings (engine picker, lip-sync modes, Piper voice browser, test button)
│       ├── mc_settings_dialog.py   # Minecraft Settings (MC connection, AI features toggles, Radar/Inventory tabs)
│       ├── memory_dialog.py        # Memory viewer (traits viewer, chat history viewer, wipe controls)
│       ├── stats_dialog.py         # RPG Stats viewer with ±5 manual controls and live color-coded bars
│       ├── theme_picker.py         # 9-theme palette picker grid
│       └── msg_limit_dialog.py     # Message history limit slider
│
├── audio/                          # Python — Acoustic Cortex
│   ├── audio.py                    # TTSWorker (QThread), TTS engine arbitration (ElevenLabs → edge-tts → Piper), SFX system, pygame mixer
│   ├── stt.py                      # STTWorker (QThread), mic recorder, Groq Whisper / faster-whisper transcription, VU meter, mic gain
│   ├── tts_elevenlabs.py           # ElevenLabsWorker (QThread), emotion→VoiceSettings mapping (19 states), quota fallback handling
│   └── run.py                      # Audio-only entry point helper
│
├── drone/                          # Node.js — The Body (Mineflayer)
│   ├── bot.js                      # WebSocket server, Mineflayer bootstrap, block.digTime shim, event routing, mode switching
│   ├── package.json                # Dependencies: mineflayer, mineflayer-pathfinder, mineflayer-collectblock, mineflayer-tool, mineflayer-auto-eat, mineflayer-armor-manager, mineflayer-pvp, ws
│   ├── package-lock.json
│   └── bots/
│       ├── task_runner.js          # % command implementations, generation-counter dead-man switch, concurrent task gating (Follow+1 rule)
│       └── follower.js             # Follow/Guard mode, local instant reactions (hostile mob detection, damage, achievements, gift detection, night messages)
│
├── assets/
│   ├── models/
│   │   └── libtashkeel_model.ort   # Arabic diacritization model
│   ├── outfits/                    # Character sprites: [prefix][emotion].png (Charlotteangry.png, Charlotteneutral.png, etc. — 20 sprites for Charlotte)
│   ├── sounds/                     # UI SFX (.wav): blip, error, notify, outfit, outfit_change, stat_down, stat_up
│   └── tts/
│       ├── piper.exe               # Piper TTS binary (offline TTS)
│       ├── onnxruntime.dll         # ONNX runtime for Piper
│       ├── onnxruntime_providers_shared.dll
│       ├── espeak-ng.dll           # eSpeak NG phonemizer for Piper
│       ├── piper_phonemize.dll
│       ├── el_45289.mp3            # ElevenLabs cached output
│       ├── speech.mp3 / speech_47995.wav  # TTS output cache
│       ├── espeak-ng-data/         # eSpeak NG language data (~140 language files + ~90 lang/ subdirectories)
│       └── voices/
│           ├── en_US-hfc_female-medium.onnx       # Piper voice model
│           ├── en_US-hfc_female-medium.onnx.json
│           ├── en_US-lessac-medium.onnx           # Piper voice model
│           └── en_US-lessac-medium.onnx.json
│
└── data/
    ├── permanent_facts.json        # Permanent traits (setup wizard answers + extracted from conversation, never expire)
    └── session_cache.json          # Raw chat history for lazy AI compression on next boot
```

---

## Launch & Run

```bash
# Launch everything (Python GUI + Node drone)
ProjectDVC.bat

# Python GUI only
python core/main.py

# Node drone only (connects to a running Minecraft server)
cd drone
node bot.js --host localhost --port 25565 --username RavenBot --version 1.21 --ws_port 8765
```

## Install Dependencies

```bash
# Python
pip install PyQt6 websockets requests sounddevice pygame-ce scipy numpy faster-whisper elevenlabs edge-tts certifi

# Node
cd drone && npm install
```

**Python version: 3.12.8. Use `pygame-ce` (Community Edition), not standard `pygame`.**

---

## Architecture

### Split-Brain Design

Two fully separate processes communicate over a local WebSocket (`ws://localhost:8765`):

- **Cortex** (`core/`, `gui/`, `audio/`) — Python/PyQt6. Owns personality, memory, voice I/O, UI, all AI calls.
- **Body** (`drone/`) — Node.js/Mineflayer. Owns all in-game automation. Has no AI dependency.

Python sends JSON commands to Node; Node emits JSON events back. `core/mc_brain.py` owns the WebSocket client. `drone/bot.js` owns the WebSocket server.

### Data Flow

```
User types  →  CompanionWindow (main.py)
               ├─ % command → mc_brain.send_cmd() → bot.js → task_runner.js
               └─ normal text → AIWorker (workers.py) → API → response → GUI
Bot event   →  bot.js → WebSocket → mc_brain.handle_event() → Qt signal → GUI
```

### Config & Persistence

Everything persists in **`dvc_profile.json`** (project root) — API keys, persona, stats, emotion state, session summary. Loaded once at import time by `core/config.py` into the module-level `CONFIG` dict. All modules import `CONFIG` from there. Call `save_config()` to flush to disk.

`traits.txt` — session-scoped learned traits. `data/permanent_facts.json` — permanent facts that never expire. `data/session_cache.json` — raw chat history for lazy compression on next boot.

### Emotion System

`self.emo` in `CompanionWindow` is the canonical emotion state. Setting it triggers sprite swap + TTS voice profile change. `talking` is a transient lip-sync-only state — never save it as persistent. Emotion extracted from AI responses via `[EMOTION: name]` tags, then keyword fallback via `_DEEP_MAP`.

### Thread Model

- **Main thread** — PyQt6 event loop, UI rendering
- **AIWorker** (QThread) — fires API requests, emits `finished`/`error` signals back to main thread
- **mc_brain_ws** (daemon thread) — asyncio loop for WebSocket listener; crosses thread boundary via `_MCBridge` Qt signals
- **task_worker** (daemon thread) — `mc_tasks.TaskQueue` worker; blocks on `threading.Event` waiting for `task_result` from Node
- **TTSWorker / STTWorker** (QThreads) — audio I/O off main thread

Never call Qt UI methods from non-main threads. Route everything through signals.

### Memory Tiers

1. **Permanent** (`data/permanent_facts.json`) — setup answers + core identity facts. Never expires. Loaded via `memory.load_permanent()`.
2. **Session traits** (`traits.txt`) — learned during conversation, capped at 30. Loaded via `save.load_traits()`.
3. **Session summary** (`dvc_profile.json["session_summary"]`) — AI-compressed paragraph of last session. Written on clean close via `memory.compress_session_async()`.

All three are injected into the system prompt via `memory.build_memory_prompt()`.

### Task Queue (Python ↔ Node)

`mc_tasks.TaskQueue` (Python) sends a command to Node, then blocks on a `threading.Event` waiting for `task_result`. `mc_brain.handle_event()` calls `task_queue.on_task_result()` when Node reports done. Open-ended tasks (`cave`, `explore`, `guard`, `strip`, `farm`, `fish`, `lumber`, `tunnel`) use `timeout=9999` — Node's own generation counter handles abort when `%stop` is called.

### Bot.js Task System

`task_runner.js` uses a **generation counter** (`_generation`) as a dead-man switch. Every task captures its generation at start (`task._gen = _generation`). `_aborted(gen)` returns true if `_generation` has since incremented (via `clearQueue`/`stop`). Check `_aborted(task._gen)` in every hot loop.

`follower.js` and `task_runner.js` are two mutually exclusive modes. `setMode()` in `bot.js` stops whichever is active before starting the other.

### Sprite Pipeline

Sprites: `assets/outfits/[prefix][emotion].png`. `gui/graphics.scan_outfits()` auto-detects outfit prefixes. Green-screen keyer removes `#00FF00` backgrounds (numpy fast-path, Qt pixel-loop fallback). Procedural fallback renders if no sprite found. `fullbody` is a special non-emotion variant used in some views.

### Theme System

`gui/theme.py` holds 9 palettes. Active theme lives in `TH._active`. `_refresh_colors()` in `main.py` syncs module-level color aliases (`BG1`, `PINK`, `CYAN`, etc.) used throughout dialog code. Call `_refresh_colors()` after any theme switch.

### TTS Priority

`audio/audio.py` `TTSWorker.run()`: ElevenLabs (if configured + `engine=="elevenlabs"`) → edge-tts (`engine=="online"`) → Piper (`engine=="offline"`). ElevenLabs falls back to edge-tts on any `EL_QUOTA:` prefixed error. Piper requires `assets/tts/piper.exe` + `.onnx`/`.onnx.json` files in `assets/tts/voices/`.

---

## Key Non-Obvious Constraints

- **`block.digTime` shim** — `bot.js` patches `bot.blockAt()` on spawn so `digTime` is always callable. Some `prismarine-block` versions cache it as a number on the instance, crashing `mineflayer-pathfinder`. Do not remove this shim.
- **Non-modal dialogs** — all settings dialogs use `.show()` not `.exec()`. Using `.exec()` blocks the Qt event loop and causes a Windows system ding. Keep all new dialogs non-modal.
- **`_RoundMenu`** — the custom context menu applies a `QRegion` mask via `QPainterPath`. CSS `border-radius` alone doesn't clip the OS window shape on Windows.
- **`send_cmd` flattening** — `mc_brain.send_cmd()` flattens `args` with `**args` into the top-level JSON payload. `bot.js` reads `msg.block`, `msg.x`, etc. directly — never nested under `"args"`.
- **`#chat` only triggers AI** — plain Minecraft chat is silently ignored by `mc_brain`. Only `#prefixed` messages and whispers call the AI.
- **`talking` emotion** — never persist it. It's transient for lip-sync only; always restore to `self.emo` after TTS finishes.
