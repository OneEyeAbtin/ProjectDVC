# 🤖 ProjectDVC (Desktop Virtual Companion)

**ProjectDVC** is an advanced, always-on-top desktop companion featuring a split-brain architecture. It consists of a sleek **Python/PyQt6 GUI Cortex** (The Brain) connected via WebSocket to a **Node.js Mineflayer Drone** (The Body) operating inside Minecraft. 

Built around a core character persona (Raven), the companion features dynamic emotional sprite rendering, multi-engine Voice integration (STT & TTS), and a zero-latency Minecraft event router.

*Created by Abtin.*

---

## ✨ Key Features

* **Always-On-Top Frameless UI:** A highly polished 400x700 PyQt6 interface with rounded corners, transparency, and a dynamic stacked-widget layout.
* **Dynamic Face & Emotion System:** Instantly swaps between 18 different emotional states and multiple outfit variations (e.g., Base, Alt Clothes, Goth) driven by real-time game events or LLM sentiment.
* **Split-Brain Minecraft Integration:** 
    * **The Brain (Python):** Handles LLM processing, voice, and user intent.
    * **The Body (Node.js):** Handles pathfinding, combat, inventory, and survival logic via Mineflayer.
* **Zero-Latency Gameplay:** Routine Minecraft events (taking damage, finding diamonds, creeper alerts) trigger instantaneous local response pools and face changes without waiting for slow API calls.
* **Autonomous Survival Bot:** Features auto-eating, auto-respawning (with death coordinate retrieval), guard mode, and tool-tier awareness (e.g., ensures an iron pickaxe is equipped before mining diamonds).
* **Acoustic System:** Fully integrated Text-to-Speech (TTS) using local Piper `.onnx` models, ElevenLabs, or edge-tts, alongside Speech-to-Text (STT) via faster-whisper.

---

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| **GUI** | Python 3.12.8, PyQt6 |
| **LLM / Brain** | Groq API, LM Studio (Local), OpenAI-compatible endpoints |
| **TTS (Speech)** | ElevenLabs (`eleven_flash_v2_5`), edge-tts, Piper (offline `.onnx`) |
| **STT (Mic)** | faster-whisper, Groq Whisper, `sounddevice`, `scipy` |
| **Audio** | `pygame` mixer |
| **Drone Body** | Node.js, `mineflayer`, `mineflayer-pathfinder`, `mineflayer-collectblock` |
| **Bridge** | Local WebSocket (`ws://localhost:8765`) |

---

## 🎮 Minecraft Commands & Gating

ProjectDVC uses a strict "AI Gating" system to save tokens and reduce latency.

* **Conversing with AI:** Prefix in-game chat with `#` (e.g., `#Hey Raven, what should we build next?`). Only hashed messages are sent to the LLM.
* **Drone Commands:** Prefix in-game chat with `%` to trigger hardcoded Baritone-style Node.js functions. 
    * *Examples:* `%mine iron 10`, `%follow User`, `%goto 100 64 -200`, `%guard`, `%cave`, `%surface`, `%status`
* **Observations:** The bot silently observes the world. Finding rare ores, taking damage, or being gifted items triggers instant, hardcoded UI responses and emotions via `follower.js`.

---

## 📂 Architecture Breakdown

* `/core/` - The Python Brain (`main.py`, `config.py`, `memory.py`, `save.py`, `mc_brain.py`, `workers.py`, `mc_tasks.py`)
* `/gui/` - Visual processing and PyQt6 themes (`graphics.py`, `theme.py`)
* `/audio/` - Voice recognition, TTS processing, and Pygame sound mixing (`audio.py`, `stt.py`, `tts_elevenlabs.py`)
* `/drone/` - The physical Node.js Mineflayer body (`bot.js`)
* `/drone/bots/` - Specific drone limb modules (`task_runner.js`, `follower.js`)
* `/assets/` - Sprites, UI sounds, and local `.onnx` voice models

---

## 🚀 Installation & Setup

### 1. Prerequisites
* **Python 3.12.8** (Do not use 3.13/3.14 as they currently break `pygame` audio mixing).
* **Node.js** (Current LTS version).
* A running Minecraft server (Vanilla, Paper, or Spigot) on version `1.21`.

### 2. Install Python Dependencies (The Cortex)
Open your terminal in the project root and run:
```bash

pip install PyQt6 websockets requests sounddevice pygame scipy numpy faster-whisper

```

### 3. Install Node.js Dependencies (The Drone)
Navigate to the drone directory and install the Mineflayer packages:

```Bash

cd drone
npm install

```
### 4. Install Piper TTS (Local Voice Engine)
Because Piper binaries are too large for GitHub, you must download them manually:

Download the latest Piper Windows zip from the Piper GitHub Releases.
Extract the contents (piper.exe, onnxruntime.dll, etc.) directly into the root ProjectDVC folder.
Place your .onnx voice models inside the voices/ folder.
### 5. Configuration
Ensure you have your desired companion sprites loaded into the /assets/chars/ folder.

Launch the application. The setup wizard will guide you through creating your dvc_profile.json (which securely stores your API keys and configuration locally).

### 6. Booting the Companion
Run the main batch file from the root directory to spin up the UI:

```Bash

ProjectDVC.bat

```