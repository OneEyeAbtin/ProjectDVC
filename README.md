Copyright (c) 2026 Abtin (github.com/OneEyeAbtin). All rights reserved.
This code may not be copied, modified, or distributed without permission.

# 🤖 ProjectDVC — Desktop Virtual Companion

**ProjectDVC** is an advanced, always-on-top desktop companion built on a split-brain architecture. A sleek **Python/PyQt6 GUI Cortex** (The Brain) connects via WebSocket to a **Node.js Mineflayer Drone** (The Body) operating inside Minecraft.

The companion features dynamic emotional sprite rendering, a tiered long-term memory system, multi-engine voice integration (STT & TTS), lip-sync animation, a Vampire Sense radar overlay, and a full Baritone-equivalent Minecraft command suite.

> **On AI assistance:** The architecture, system design, character concepts, and creative direction were conceived by Abtin. AI tools assisted in translating those ideas into code — think of it as a very fast pair programmer who writes what you describe. Every feature decision, persona, interaction style, and design choice came from a human brain first.

> **On the characters:** Raven, Charlotte, and all companion sprites are **AI-generated pixel art** — created with AI image tools and hand-curated to fit the companion's emotional states and outfit variations.

*Created by Abtin.*

---

## ✨ Feature Overview

### 🖥️ Core UI
- **Always-on-top frameless window** — 400×700px, draggable, transparent, true rounded corners via `QPainterPath` mask (not just CSS border-radius, which only paints rounded visuals without clipping the OS window shape)
- **Non-modal settings panels** — all dialogs use `dlg.show()` instead of `exec()`, keeping the main window fully interactive while settings are open and eliminating the Windows ding sound
- **Stacked widget layout** — Setup Wizard page → Main Companion page, driven by profile completion state
- **Chat / Console / Radar / Inventory tabs** — the bottom panel switches between normal conversation, live bot.js output stream, the radar scope, and the bot's inventory tracker
- **Right-click context menu** — full settings access, outfit switching, persona switching, theme picker, and interaction triggers, all from a single `_RoundMenu` with OS-level rounded clip masks

### 😳 Emotion Engine
19 distinct emotional states, each with its own sprite swap, voice settings profile, and response tendencies:

`neutral` · `happy` · `excited` · `love` · `blush` · `sad` · `angry` · `shocked` · `confused` · `thinking` · `annoyed` · `bored` · `sleepy` · `smirk` · `evil` · `mocking` · `eyeroll` · `disgusted` · `talking`

The `talking` state is a transient 19th emotion used exclusively for lip-sync — `self.emo` is never set to it permanently, so it always restores cleanly to the prior expression.

Emotions are extracted from AI responses via `[EMOTION: name]` tags and a keyword deep-scan fallback. Emotion state persists across sessions via `dvc_profile.json`.

### 🎙️ Lip-Sync Animation
Two independently toggleable lip-sync modes, both configurable in TTS Settings:
- **TTS mode** — sprite alternates between the current emotion and `talking` every 150ms while audio plays. A pygame poll timer detects when the audio finishes and snaps back.
- **Text typing mode** — mouth moves once per word as the companion's response streams into the bubble, even with TTS off.

### 🧠 Three-Mode Intelligence
Switchable at runtime from the top bar or Settings → General, no restart required:

| Mode | Backend |
|---|---|
| 🖥️ Local | LM Studio / Ollama (any OpenAI-compatible local endpoint) |
| 🌐 Online | Groq, OpenAI, or any compatible cloud API |
| 💾 Offline | Rule-based fallback pool, zero API calls |

A separate Minecraft Brain config (URL, key, model) allows the drone to use a different model than the desktop companion.

### 🧬 Long-Term Memory & Trait Extractor
The most important feature for making the companion feel alive over time. When you say something like *"I like coffee"* or *"I'm studying engineering"*, the AI extracts it as a trait and saves it to `traits.txt`. On every subsequent conversation the companion already knows these facts.

The memory system has three tiers:

**1. Permanent Profile** — Core identity facts extracted from the Setup Wizard and conversation (name, age, hobbies, music taste, fears, humor style, etc.). Stored in `data/permanent_facts.json`. Never expires.

**2. Session Traits** — Things learned during conversation. Saved to `traits.txt` and injected into every system prompt. Capped at 30 recent entries; oldest drop off first.

**3. Session Summary** — On clean close, the AI asynchronously compresses the last session's chat history into a 2–3 sentence paragraph (lazy — runs on next boot to avoid slowing shutdown). That summary is prepended to the next session's context so she remembers what you talked about.

**Deduplication** — Near-duplicate traits (≥82% sequence match) are merged on every save, keeping the longer/more specific version. This prevents `user likes coffee` and `user enjoys coffee` both accumulating.

**Trait compression** — When session traits grow large, the AI rewrites them as 4–6 compact information-dense sentences, keeping all facts but removing redundancy.

### 💕 RPG Stats & Hearts System
10 live stats tracked as 0–100 values: Affection, Rizz, Nerdiness, Sass, Chaos, Loyalty, Creativity, Wisdom, Humor, Romance. Stats decay and rise based on interactions. The top-bar heart display pulses through 5 colour stages tied to the Affection value. A Stats dialog provides ±5 manual controls with live colour-coded bars.

### 🎭 Personas
21 fully written persona profiles, each a complete character description. Switchable at runtime from the right-click menu or Settings. Persona affects system prompt tone, greeting style, and response tendencies.

**Relationship:** Friend, Girlfriend, Best Friend, Mentor  
**Aesthetic:** Gothic, Friendly Goth, Goth Baddie, Catgirl, Royal, Vampire  
**Character:** Pirate, Alien, Scientist, Sporty, Glitching Android  
**Chaos:** Gremlin, Mean Girl, Hater, Maid That Hates You, Tired College Student

### 🎮 Easter Eggs / Cheat Codes
Type directly into the chat input:

| Code | Effect |
|---|---|
| `rosebud` | Max affection |
| `iddqd` | Max ALL stats |
| `amnesia` | Wipe short-term memory |
| `upupdowndown` | Switch to Girlfriend persona |
| `force[emotion]` | Force any emotion state (e.g. `forceevil`) |

### 🎨 Themes
12 built-in color palettes, live-switchable with no restart. Each theme defines `BG1–BG4`, `ACC1–ACC3`, `TXT1–TXT2`, border, gradient, glow, and button gradient roles that bleed through every pixel of the UI:

🌸 Midnight Sakura · 🩸 Crimson Abyss · 🌊 Ocean Dream · 🌿 Forest Dusk · 🎵 Synthwave · 🧊 Arctic Ghost · 🩸 Darkwave · 💻 Matrix · 🕊️ Ethereal · 🌆 Neon City · 🖲️ Amber Terminal · ✨ Gold

### 💬 Interactions
Right-click → Interact to trigger 12 named interaction events that send special action prompts to the AI and update stats:
Pat Head · Hug · Poke · Kiss · Tickle · Gift · Boop Nose · Head Pat · Hold Hands · Feed Snack · Whisper · Stare Contest · Compliment · Dance Together

### ⚙️ Unified Settings Dialog
All configuration lives in a single tabbed dialog (right-click → Settings or keyboard shortcut), no more hunting across multiple popup windows:

| Tab | Contents |
|---|---|
| ⚙️ General | User & companion name, brain mode selector (Local / Online / Offline), hearts toggle, conversation history limit, redo setup wizard, factory reset |
| 🧠 Memory | Long-term trait viewer, chat history viewer, wipe controls, message limit slider |
| 🌐 AI/API | Online API (URL, key, model), Local API (LM Studio / Ollama), Minecraft Brain API — all in one place |
| 🔊 TTS | Enable/disable toggle, lip-sync modes, engine selector (ElevenLabs / edge-tts / Piper), ElevenLabs API key + Voice ID + model, Piper voice file browser, edge-tts voice picker, test button with emotion selector |
| 🎤 STT | Engine selector (Groq / Local Whisper), model picker, microphone device selector, mic gain slider (1×–20×), full mic test with VU meter and playback |

One **💾 Save All & Close** button at the bottom saves every tab simultaneously — no more accidentally losing STT settings while saving TTS or vice versa.

---

## ⛏️ Minecraft Drone (Mineflayer)

The body is a Node.js Mineflayer bot connected to the Python cortex via a local WebSocket (`ws://localhost:PORT`). **Only `#chat` messages trigger the AI** — all other events and commands are instant, zero-latency, local responses.

### Survival Intelligence (automatic, no commands needed)
- **Auto-respawn + item retrieval** — respawns after 1.5s, remembers death coordinates, auto-queues `%goto deathPos` + `%collect`
- **Auto-eat** — checks every 5s and on health events, 20-food priority list (golden apple → porkchop → bread), eats mid-task
- **Auto-defend on attack** — on any damage event, immediately equips best sword (Netherite → Diamond → Iron) and swings back at nearest hostile within 8 blocks
- **Face changes on ANY hit** — big hit → shocked, medium → angry, small → sad, fires before HP updates
- **Auto-armor management** — equips best available armor automatically
- **Tool tier checking** — diamond ore needs iron+ pickaxe; returns a clear error if not available, re-equips during mining if tool breaks
- **Auto-depth mining** — Diamond→Y=−58, Iron→Y=16, Coal→Y=96; pathfinds down first, digs if pathfinding fails
- **Gift detection** — drops an item near the bot → she picks it up, recognizes it was from you, responds with love face + gift dialogue
- **Lava evasion** — auto-detects and avoids lava hazards during navigation

### Instant Local Reactions (0ms latency, no API call)
| Event | Response |
|---|---|
| Sees diamonds | `*SCREAMS* DIAMONDS!! YES YES YES!!` (4 variants) |
| Creeper spotted | `CREEPER!! NOT TODAY!!` |
| Takes damage | Instant emotion change + combat |
| Night falls | `*shivers* Night again. I hate this part.` |
| Achievement unlocked | `*claps* ACHIEVEMENT UNLOCKED!! LET'S GO!!` |
| Item gifted by player | love emotion + special gift dialogue |

### `%` Command Reference
All commands work from Minecraft chat and from the GUI console tab.

**⛏ Mining & Gathering**
`%mine <block> [n]` · `%cave` · `%strip [length]` · `%tunnel [length]` · `%lumber` · `%farm` · `%collect` · `%surface`

**🗡 Combat**
`%kill <mob> [n]` · `%killall [radius]` · `%guard [player] [r] [secs]`

**🧭 Navigation**
`%goto x y z` · `%come` · `%follow [player]` · `%explore [radius]`

**🎒 Inventory & Crafting**
`%inv` · `%equip <item> [slot]` · `%drop <item> [n]` · `%store [item]` · `%loot` · `%craft <item> [n]` · `%smelt <item> [n]` · `%eat`

**🏗 Building & Utility**
`%pillar [height]` · `%torch [n]` · `%sleep` · `%fish [secs]`

**📊 Info & Control**
`%status` · `%pos` · `%stop` · `%mode` · `%help`

**😊 Emotes**
`%emote shrug/happy/sad/angry/love/blush/wave/yay/cry/evil/smug/think/sleep/surprised/confused/bow/ok/no/nervous/wink/peek/hearts/pout/stare/sweat`

**💬 AI Chat**
`#message` — any message prefixed with `#` (or a whisper `/w BotName`) triggers an AI response. Plain chat is silently ignored to save tokens.

### 🛰️ Vampire Sense Radar
A semi-transparent radar overlay drawn directly on the companion portrait. 32-block world radius, 3 grid rings, red dots for hostile mobs, cyan dots for players, white dot for the bot. Toggle from the MC bar or the Radar tab in MC Settings.

### 🎒 Inventory & Status Tracker
The Inventory tab in MC Settings shows a live grouped inventory list and a status bar (❤️ HP · 🍖 Food · 📍 Coords · ⭐ XP Level). Auto-refreshes every 5 seconds when tracking is enabled.

### AI Gating (token efficiency)
```
Player types "hello"          → ignored (no API call)
Player types "#hello"         → AI responds
Player types "%mine diamond"  → queueTask instantly
Bot dies                      → respawn → goto(deathPos) → collect (automatic)
Player drops item near bot    → love emotion + gift dialogue (local)
```

---

## 🔊 Voice System

### TTS Engines (priority order)
| Engine | Notes |
|---|---|
| 🎙️ ElevenLabs | Emotion-mapped `VoiceSettings` per state — stability, similarity\_boost, style tuned for all 19 emotions. Tone is shaped through `VoiceSettings` only, not text prefixes (so `eleven_flash_v2_5` doesn't read acting directions aloud). Falls back to edge-tts on quota/auth error. |
| 🌐 edge-tts | Microsoft Azure neural voices. Free, online, no API key. Many language/accent options. |
| 💾 Piper | Fully offline `.onnx` TTS via `piper.exe`. Drop `.onnx` + `.onnx.json` files into `assets/tts/voices/`. Quick-switch combo box at the top of TTS Settings, no restart needed. |

### STT Engines
| Engine | Notes |
|---|---|
| 🌐 Groq Whisper | `whisper-large-v3-turbo` (free tier). Captures at device native rate, resamples to 16kHz, sends as WAV. |
| 💾 Local Whisper | `faster-whisper` (CTranslate2, int8, CPU). Downloads model on first use, cached after. |

### Mic Features
- **VU meter** — 8-segment bar next to the mic button during recording. 20-segment bar in STT Settings test mode. Log₂ scaling so quiet speech fills ~50% of the bar.
- **Mic gain** — 1×–20× amplification adjustable live via slider, applies to both recording and the VU display.
- **Mic test** — record a clip, play it back instantly with a progress bar, no transcription needed — just to check levels.
- **Auto-send** — after Whisper transcription, the text populates the input and auto-sends after 600ms so you can see what was recognized.

---

## 🎨 Characters & Sprites

The companion ships with multiple characters — **Raven** (default, Vampire persona) and **Charlotte** among them. All character sprites are **AI-generated pixel art**, created with AI image tools and curated to cover all 19 emotional states plus outfit variations (Base, Alt, Goth, etc.).

Sprites are stored in `assets/outfits/` as `[prefix][emotion].png` files. The engine auto-detects outfit prefixes by scanning the folder and registers them at startup. A green-screen keyer (`#00FF00` background removal via numpy fast-path) processes sprites that need transparency. A procedural fallback character renders if no sprite file is found for a given state.

To add your own character: place `[name][emotion].png` files in `assets/outfits/` and relaunch. The outfit will appear in the right-click menu automatically.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **GUI** | Python 3.12.8, PyQt6 |
| **LLM / Brain** | Groq API, LM Studio, OpenAI-compatible endpoints |
| **TTS** | ElevenLabs (`eleven_flash_v2_5`), edge-tts, Piper (`.onnx`) |
| **STT** | faster-whisper (CTranslate2), Groq Whisper, `sounddevice`, `scipy` |
| **Audio** | `pygame-ce` mixer (Community Edition, 16 channels, dedicated SFX channel) |
| **Memory** | `traits.txt` + `data/permanent_facts.json` + `data/session_cache.json` |
| **Drone Body** | Node.js, `mineflayer`, `mineflayer-pathfinder`, `mineflayer-pvp`, `mineflayer-collectblock`, `mineflayer-tool`, `armor-manager` |
| **Bridge** | Local WebSocket (`ws://localhost:8765`) |

> ⚠️ **Python version:** Use **Python 3.12.8** or later. Audio requires **pygame-ce** (Community Edition) — not the standard `pygame`. Install with `pip install pygame-ce`. pygame-ce 2.5.7+ supports Python 3.12 and 3.13; for 3.14 support check the latest release.

---

## 🚀 Installation & Setup

### 1. Prerequisites
- **Python 3.12.8**
- **Node.js** (current LTS)
- A running Minecraft server (Vanilla / Paper / Spigot) on version `1.21`

### 2. Python dependencies
```bash
pip install PyQt6 websockets requests sounddevice pygame-ce scipy numpy faster-whisper elevenlabs edge-tts
```

### 3. Node.js dependencies
```bash
cd drone
npm install
```

### 4. Piper TTS (optional, offline voice)
Piper binaries are too large for the repo. Download manually:
1. Download the latest Piper Windows zip from [Piper GitHub Releases](https://github.com/rhasspy/piper/releases)
2. Extract `piper.exe` and `onnxruntime.dll` into `assets/tts/`
3. Place `.onnx` + `.onnx.json` voice files in `assets/tts/voices/`

Voice models: [github.com/rhasspy/piper/blob/master/VOICES.md](https://github.com/rhasspy/piper/blob/master/VOICES.md)

### 5. Launch
```bash
ProjectDVC.bat
```

The Setup Wizard runs on first launch and creates `dvc_profile.json` with your name, companion name, persona choice, and API keys. All keys are stored locally — never transmitted anywhere except the APIs you configure.

---

## 📂 Project Structure

```
ProjectDVC/
├── core/
│   ├── main.py          # CompanionWindow, all dialogs, emotion engine, UI routing
│   ├── config.py        # Central config, path routing, profile load/save
│   ├── memory.py        # Tiered memory, trait extractor, dedup, compression
│   ├── save.py          # Save data I/O layer, traits.txt read/write
│   ├── workers.py       # AIWorker QThread (fires API requests off main thread)
│   ├── mc_brain.py      # WebSocket bridge, MC event router
│   └── mc_tasks.py      # Motor cortex task queue, % command parser
├── gui/
│   ├── graphics.py      # Sprite pipeline, green-screen keyer, fallback renderer
│   └── theme.py         # 12 color themes, live stylesheet builder
├── audio/
│   ├── audio.py         # Pygame mixer, TTS engine arbitration, SFX system
│   ├── stt.py           # Mic recorder, Groq/local Whisper transcription
│   └── tts_elevenlabs.py# ElevenLabs API, emotion→VoiceSettings mapping
├── drone/
│   ├── bot.js           # Mineflayer bot, WebSocket server, event routing
│   └── bots/
│       ├── task_runner.js  # All % command implementations
│       └── follower.js     # Follow mode, guard mode, local instant reactions
├── assets/
│   ├── outfits/         # Character sprites ([prefix][emotion].png)
│   ├── sounds/          # Procedurally generated UI SFX (.wav)
│   └── tts/
│       └── voices/      # Piper .onnx voice models
│
└── data/
    ├── permanent_facts.json  # Long-term permanent trait storage
    └── session_cache.json    # Raw history for lazy compression on next boot

```
## License

Copyright (c) 2026 Abtin (github.com/OneEyeAbtin). All rights reserved.

This project and its source code are proprietary and confidential. You may not copy, modify, distribute, or use this code for any purpose without explicit permission from the author.