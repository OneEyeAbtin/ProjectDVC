"""
[MODULE] config.py
[SYSTEM] ProjectDVC - Central Nervous System & Profile Routing
[AUTHOR] Abtin

Copyright (c) 2026 Abtin (github.com/OneEyeAbtin). All rights reserved.
This code may not be copied, modified, or distributed without permission.
"""
import json
from pathlib import Path

# Since config.py is in core/, we go up one level to hit the root
BASE         = Path(__file__).parent.parent
PROFILE_PATH = BASE / "dvc_profile.json"
TRAITS_PATH  = BASE / "traits.txt"

# Media Vault Routing
OUTFITS_DIR  = BASE / "assets" / "outfits"
SOUNDS_DIR   = BASE / "assets" / "sounds"
TTS_DIR      = BASE / "assets" / "tts"
VOICES_DIR   = TTS_DIR / "voices"

# Legacy aliases
CONFIG_PATH = PROFILE_PATH
SAVE_PATH   = PROFILE_PATH

_DEFAULTS: dict = {
    # ── Local Brain (LM Studio / Ollama standard port) ──
    "local_api_url": "http://localhost:1234/v1/chat/completions",
    "local_api_key": "", 
    "local_api_model": "",

    # ── Cloud Brain (Agnostic) ──
    "online_api_url": "",
    "online_api_key": "", 
    "online_api_model": "",

    "max_history": 20,
    "tts": {"enabled": False, "engine": "online", "online_voice": "en-US-AriaNeural"},
    "elevenlabs": {"api_key": "", "voice_id": "", "model_id": ""},
    "stt": {"engine": "groq", "groq_model": "", "local_model": "base", "mic_gain": 4.0},
    
    # ── Mineflayer Drone Brain ──
    "minecraft": {
        "host": "localhost", "port": 25565, "username": "RavenBot",
        "version": "1.21", "auth": "offline", "ws_port": 8765,
        "brain_url": "",
        "brain_key": "", 
        "brain_model": "",
        "ai_features": {"ai_hash_chat": True, "ai_advancements": False, "ai_task_done": False, "ai_events": False},
    },
    "setup_questions": [], "personas": {"Tsundere": "Classic tsundere."},
    "default_persona": "Tsundere", "outfits": {"Base": ""}, "interactions": {},
    "emotions": [
        "neutral","happy","sad","angry","blush","thinking","love","sleepy",
        "excited","confused","bored","annoyed","evil","eyeroll","mocking",
        "smirk","shocked","disgusted","talking",
    ],
    "cheat_codes": {}, "mine_blacklist": ["chest"], "mine_whitelist": [], "friends": [],
    # save data
    "user_name": "User", "pet_name": "Companion", "persona": "Tsundere",
    "outfit": "Base", "brain_mode": "online",
    "stats": {"affection":20,"rizz":5,"nerdiness":10,"sass":15,"chaos":5,
              "loyalty":10,"creativity":10,"wisdom":5,"humor":10,"romance":5},
    "tts_enabled": False, "tts_engine": "online",
    "lip_sync_tts": True, "lip_sync_text": False,
    "selected_offline_voice": "", "hearts_visible": True,
    "setup_complete": False, "setup_answers": {},
    "last_emotion": "neutral", "theme": "Midnight Sakura",
}

def _migrate() -> dict:
    profile = dict(_DEFAULTS)
    for fname in ["config.json", "save_data.json"]:
        p = BASE / fname
        if p.exists():
            try:
                with open(p,"r",encoding="utf-8") as f: profile.update(json.load(f))
                print(f"[PROFILE] Migrated {fname}")
            except Exception as e: print(f"[PROFILE] migrate {fname}: {e}")
    return profile

def load_config() -> dict:
    if PROFILE_PATH.exists():
        try:
            with open(PROFILE_PATH,"r",encoding="utf-8") as f: data=json.load(f)
            for k,v in _DEFAULTS.items():
                data.setdefault(k,v)
            return data
        except Exception as e: print(f"[PROFILE] load error: {e}")
    profile = _migrate()
    try:
        with open(PROFILE_PATH,"w",encoding="utf-8") as f: json.dump(profile,f,indent=2,ensure_ascii=False)
    except Exception as e: print(f"[PROFILE] save error: {e}")
    return profile

CONFIG = load_config()

def save_config() -> None:
    with open(PROFILE_PATH,"w",encoding="utf-8") as f:
        json.dump(CONFIG,f,indent=2,ensure_ascii=False)
