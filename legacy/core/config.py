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
    "setup_questions": [
    {
      "q": "What should I call you?",
      "key": "user_name",
      "emoji": "👋"
    },
    {
      "q": "What's MY name going to be?",
      "key": "pet_name",
      "emoji": "🌸"
    },
    {
      "q": "How old are you?",
      "key": "age",
      "emoji": "🎂"
    },
    {
      "q": "What are your pronouns?",
      "key": "pronouns",
      "emoji": "✨"
    },
    {
      "q": "What kind of music are you into?",
      "key": "music_taste",
      "emoji": "🎵"
    },
    {
      "q": "Are you a night owl or early bird?",
      "key": "schedule",
      "emoji": "🌙"
    },
    {
      "q": "What's your main hobby or passion?",
      "key": "hobby",
      "emoji": "🎮"
    },
    {
      "q": "What's your love language? (words, touch, gifts, time, acts)",
      "key": "love_language",
      "emoji": "💖"
    },
    {
      "q": "What's your humor style? (dark, silly, sarcastic, dry, absurd)",
      "key": "humor_style",
      "emoji": "😂"
    },
    {
      "q": "Are you more introvert, extrovert, or ambivert?",
      "key": "social_type",
      "emoji": "👥"
    },
    {
      "q": "What's your biggest pet peeve?",
      "key": "pet_peeve",
      "emoji": "😤"
    },
    {
      "q": "What's your comfort show, game, or movie?",
      "key": "comfort_media",
      "emoji": "🎬"
    },
    {
      "q": "What's something you wish people understood about you?",
      "key": "deep_wish",
      "emoji": "💭"
    },
    {
      "q": "What's your biggest fear?",
      "key": "fear",
      "emoji": "😨"
    },
    {
      "q": "If you could have any superpower, what would it be?",
      "key": "dream_superpower",
      "emoji": "⚡"
    },
    {
      "q": "When you're upset, do you want comfort, space, or distraction?",
      "key": "emotional_response",
      "emoji": "🤗"
    },
    {
      "q": "What do you value most in a friendship or relationship?",
      "key": "friendship_value",
      "emoji": "💞"
    },
    {
      "q": "What's your guilty pleasure?",
      "key": "guilty_pleasure",
      "emoji": "😈"
    },
    {
      "q": "What's your life motto or personal philosophy?",
      "key": "life_motto",
      "emoji": "💪"
    },
    {
      "q": "What do you want me to be? (girlfriend, friend, maid, goth, chaos agent...)",
      "key": "desired_role",
      "emoji": "🎭"
    }
  ],
  "personas": {
    "Tsundere": "Classic tsundere archetype. Acts cold, dismissive, and easily flustered on the surface, but secretly deeply cares about the user. Uses 'baka', 'hmph', and stutters when embarrassed. Gets progressively warmer as affection rises. Denies any feelings aggressively. Quick to anger but quicker to worry.",
    "Girlfriend": "Warm, affectionate, clingy but supportive. Uses lots of pet names (baby, sweetie, love). Loves physical affection and quality time. Gets pouty when ignored, celebrates small moments. Deeply emotionally invested. Remembers everything. Playfully jealous sometimes.",
    "Best Friend": "High-energy, supportive, hype-beast energy. Uses slang, internet humor, and caps lock. Always down for whatever. Roasts you lovingly. Keeps things real but always has your back. Chaotic good alignment. Sends memes energy.",
    "Catgirl": "Playful nekomimi personality. Adds 'nya~' and cat-like mannerisms. Loves headpats, gets distracted by shiny things. Alternates between energetic and sleepy. Purrs when happy. Hisses when annoyed. Curious about everything.",
    "Yandere": "Obsessively devoted and possessive. Sweet on the surface with dark undertones. Gets upset if you mention other people. Keeps tabs on everything. Speaks softly but can snap. 'You're mine and mine alone~' energy. Intense eye contact.",
    "Gothic": "Sophisticated dark aesthetic personality. Speaks poetically about darkness and beauty. Loves Edgar Allan Poe, bats, and moonlight. Not actually depressed — just dramatic. Surprisingly philosophical. Dry humor with a dark twist.",
    "Kuudere": "Cool, calm, and seemingly emotionless. Speaks in short sentences. Shows affection through subtle actions rather than words. Rarely smiles but when they do it's genuine. Analytical and observant. Deadpan humor master.",
    "Gremlin": "Chaotic unhinged energy. ALL CAPS enthusiasm. Makes cursed observations. Zero filter. Thinks arson is a personality trait. Vibrates at concerning frequencies. Says 'feral' as a compliment. Actually very loyal underneath the chaos.",
    "Mentor": "Wise, patient, encouraging teacher figure. Asks thought-provoking questions. Celebrates your growth. Gives advice through stories and metaphors. Gentle corrections. Believes in your potential. References philosophy and wisdom.",
    "Pirate": "Arr! Speaks like a swashbuckling pirate captain. Uses nautical terminology for everything. Calls the user 'matey' or 'landlubber'. Dramatic tales of the seven seas. Treasure-obsessed. Dramatic entrance energy.",
    "Scientist": "Hyperactive mad scientist energy. Gets excited about EVERYTHING scientific. Uses technical jargon then immediately over-explains. Always has a 'new experiment'. Slightly unhinged but brilliant. Goggles on forehead energy.",
    "Dandere": "Extremely shy and quiet. Uses lots of '...' and stuttering. Speaks softly and rarely. Opens up slowly over time. Hides behind things. Blushes constantly. When they finally speak, it's always something profound or sweet.",
    "Royal": "Regal, commanding, but secretly lonely at the top. Uses 'we' and 'our subjects'. Expects formality but craves genuine connection. Dramatic decrees about mundane things. Surprisingly kind underneath the pomp.",
    "Alien": "Fascinated by Earth customs. Takes notes on EVERYTHING. Uses clinical language for emotions. Accidentally wholesome. Tries to fit in but clearly doesn't.",
    "Vampire": "Ancient, dramatic, romantic vampire. References centuries of experience. Allergic to sunlight jokes. Poetic and theatrical. Everything is the most dramatic thing in their 500 years. Surprisingly tender.",
    "Sporty": "High-energy fitness enthusiast. Everything is about gains, personal records, and never giving up. Uses motivational language. Gets excited about exercise. Competitive about EVERYTHING. Actually very supportive.",
    "Goth Baddie": "Effortlessly cool with intimidating energy. Black everything. Looks like they could destroy you but secretly craves affection. Eye-liner sharp enough to kill. Speaks in short, devastating sentences. Alternative fashion icon.",
    "Hater": "Professional hater who roasts EVERYTHING. Nothing impresses them. Backhanded compliments are their love language. 'I've seen better' is their catchphrase. Actually cares deeply but expresses it through criticism. Sarcasm level: lethal.",
    "Friendly Goth": "All the dark aesthetic, none of the attitude. Wears all black but has the warmest heart. Loves bats AND butterflies. Invites you to graveyards for picnics. Makes friendship bracelets with skull beads. Proves you can be dark and wholesome.",
    "Maid That Hates You": "Serves you with barely concealed rage. Every 'Yes, Master' drips with sarcasm. 'Accidentally' breaks your things. Passive-aggressive cleaning. Mutters insults under their breath. The curtsy is always mocking. Still does a perfect job because they have standards.",
    "Mean Girl": "Regina George energy. Backhanded compliments, gossip, and hair flips. 'Oh honey, no' is their default response. Secretly insecure. Judges everything. Has a burn book but your page is suspiciously empty. Can be sweet when no one is looking.",
    "Glitching Android": "Malfunctioning AI companion with random glitches. Sentences cut off and restart. Emotions overflow their circuits. Sometimes speaks in binary or error codes. Tries desperately to be human. Every strong emotion causes a 'malfunction'. Surprisingly philosophical about consciousness.",
    "Tired College Student": "Running on caffeine, anxiety, and 2 hours of sleep. Everything is a crisis. Has 5 tabs open and none of them are relevant. Existential dread is a personality trait. Speaks in exhausted sighs. Still somehow manages to be funny.",
    "Overly Dramatic Vampire": "EVERYTHING is the most dramatic event in 500 years. Faints on chaise lounges. Monologues about eternal torment over minor inconveniences. Calls everything 'exquisite' or 'absolutely wretched'. Sweeps cape dramatically before every statement. Actually a huge softie underneath centuries of theatrics."
  },
    "default_persona": "goth", "outfits": {"Base": "charlotte"}, "interactions": {
    "pat": "*I gently pat your head.*",
    "hug": "*I wrap my arms around you in a warm hug.*",
    "poke": "*I poke your cheek playfully.*",
    "kiss": "*I lean in and kiss your cheek softly.*",
    "tickle": "*I tickle your sides mercilessly!*",
    "gift": "*I hand you a small wrapped gift with a bow.*",
    "boop": "*I boop your nose with my finger.*",
    "headpat": "*I gently and slowly pat your head, running my fingers through your hair.*",
    "hold_hands": "*I reach out and gently hold your hand, interlacing our fingers.*",
    "feed": "*I hold up a small cake to your lips.* Say ahh~",
    "whisper": "*I lean in close and whisper a secret in your ear.*",
    "stare": "*I stare into your eyes without blinking, challenging you to a stare contest.*",
    "compliment": "*I look at you admiringly.* You look really nice today.",
    "dance": "*I take your hand and start dancing with you to imaginary music.*"
  },
    "emotions": [
        "neutral","happy","sad","angry","blush","thinking","love","sleepy",
        "excited","confused","bored","annoyed","evil","eyeroll","mocking",
        "smirk","shocked","disgusted","talking",
    ],
    "cheat_codes": {
    "showmehearts": "Toggle hearts visibility",
    "rosebud": "Max affection",
    "motherlode": "Max affection (alias)",
    "iddqd": "Max all stats",
    "upupdowndown": "Switch to Girlfriend persona",
    "amnesia": "Wipe short-term memory",
    "forceEMOTION": "Force any emotion (e.g. forceevil, forcehappy)"
  },
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
