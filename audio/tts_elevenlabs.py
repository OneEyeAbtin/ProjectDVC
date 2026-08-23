"""
[MODULE] tts_elevenlabs.py
[SYSTEM] ProjectDVC - ElevenLabs Vocal Synthesis & Emotion Modulation Layer
[AUTHOR] Abtin

Interfaces with the ElevenLabs API to synthesize speech with per-emotion
VoiceSettings tuning (stability, similarity_boost, style, speaker_boost).
Handles quota/auth failures gracefully — emits EL_QUOTA: prefixed errors
so the upstream TTSWorker can fall back to edge-tts without user-visible noise.
Configure api_key and voice_id in your config.json before use.

Copyright (c) 2026 Abtin (github.com/OneEyeAbtin). All rights reserved.
This code may not be copied, modified, or distributed without permission.
"""
import ssl, certifi, os, re, time
# Fix SSL errors on Windows with some antivirus setups
os.environ.setdefault("SSL_CERT_FILE", certifi.where())
os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
from pathlib import Path
from PyQt6.QtCore import QThread, pyqtSignal
from core.config import CONFIG, TTS_DIR

# ── Emotion → voice settings map ─────────────────────────────────────────────
# stability    : 0.0 (very expressive/chaotic) → 1.0 (flat/consistent)
# similarity   : how closely to stick to the original voice clone
# style        : style exaggeration 0-1 (eleven_multilingual_v2 / turbo_v2+ only)
# speaker_boost: extra clarity boost
#
EMOTION_SETTINGS: dict[str, dict] = {
    "neutral":   {"stability": 0.50, "similarity_boost": 0.75, "style": 0.10, "speaker_boost": True},
    "happy":     {"stability": 0.40, "similarity_boost": 0.80, "style": 0.40, "speaker_boost": True},
    "excited":   {"stability": 0.20, "similarity_boost": 0.85, "style": 0.80, "speaker_boost": True},
    "love":      {"stability": 0.55, "similarity_boost": 0.80, "style": 0.35, "speaker_boost": True},
    "blush":     {"stability": 0.60, "similarity_boost": 0.75, "style": 0.25, "speaker_boost": True},
    "sad":       {"stability": 0.75, "similarity_boost": 0.70, "style": 0.15, "speaker_boost": False},
    "angry":     {"stability": 0.15, "similarity_boost": 0.90, "style": 0.90, "speaker_boost": True},
    "annoyed":   {"stability": 0.30, "similarity_boost": 0.85, "style": 0.60, "speaker_boost": True},
    "shocked":   {"stability": 0.10, "similarity_boost": 0.90, "style": 0.85, "speaker_boost": True},
    "thinking":  {"stability": 0.65, "similarity_boost": 0.70, "style": 0.10, "speaker_boost": False},
    "confused":  {"stability": 0.45, "similarity_boost": 0.75, "style": 0.20, "speaker_boost": False},
    "sleepy":    {"stability": 0.85, "similarity_boost": 0.65, "style": 0.05, "speaker_boost": False},
    "bored":     {"stability": 0.80, "similarity_boost": 0.65, "style": 0.05, "speaker_boost": False},
    "smirk":     {"stability": 0.45, "similarity_boost": 0.80, "style": 0.45, "speaker_boost": True},
    "mocking":   {"stability": 0.35, "similarity_boost": 0.80, "style": 0.55, "speaker_boost": True},
    "eyeroll":   {"stability": 0.40, "similarity_boost": 0.75, "style": 0.40, "speaker_boost": False},
    "evil":      {"stability": 0.25, "similarity_boost": 0.85, "style": 0.75, "speaker_boost": True},
    "disgusted": {"stability": 0.30, "similarity_boost": 0.80, "style": 0.65, "speaker_boost": True},
}

# ── Quota / rate-limit error tags ────────────────────────────────────────────
# Any RuntimeError whose message contains one of these strings means EL is
# temporarily or permanently unavailable — audio.py will fall back to edge-tts.
EL_QUOTA_ERRORS = frozenset([
    "402", "401", "429",
    "payment_required", "paid_plan_required",
    "quota_exceeded", "rate_limit", "insufficient_credits",
    "too many requests", "unauthorized",
])
# eleven_flash_v2_5 does NOT interpret bracket acting directions — it reads
# them aloud. Tone shaping is done entirely through VoiceSettings (stability,
# similarity_boost, style). Keep this dict empty so nothing is prepended.
EMOTION_PROMPTS: dict[str, str] = {}

# ── Config helpers ────────────────────────────────────────────────────────────
def el_cfg() -> dict:
    return CONFIG.get("elevenlabs", {})

def is_configured() -> bool:
    c = el_cfg()
    return bool(c.get("api_key") and c.get("voice_id"))

# ── Main synthesis function ───────────────────────────────────────────────────
def synthesize(text: str, emotion: str = "neutral", out_path: str = None) -> str:
    """
    Generate speech with emotion-tuned voice settings.
    Returns the path to the output .mp3 file.
    Raises RuntimeError on failure.
    """
    from elevenlabs.client import ElevenLabs
    from elevenlabs import VoiceSettings

    c        = el_cfg()
    api_key  = c.get("api_key",  "")
    voice_id = c.get("voice_id", "")
    model_id = c.get("model_id", "")

    if not api_key or not voice_id:
        raise RuntimeError("ElevenLabs not configured — set api_key and voice_id in config.json")

    # Build output path
    if not out_path:
        out_path = str(TTS_DIR / f"el_{int(time.time()*1000) % 99999}.mp3")

    # Clean text of internal tags
    clean = re.sub(r"\*[^*]+\*", "", text)
    clean = re.sub(r"\[.*?\]",   "", clean)
    clean = clean.strip()
    if not clean:
        raise RuntimeError("Empty text after cleaning")

    # Emotion tone is shaped purely through VoiceSettings — no text prefix
    emo      = emotion.lower() if emotion else "neutral"
    final    = clean

    # Get voice settings for this emotion
    settings = EMOTION_SETTINGS.get(emo, EMOTION_SETTINGS["neutral"])
    # eleven_monolingual_v1 doesn't support style parameter
    supports_style = model_id not in ("eleven_monolingual_v1", "eleven_multilingual_v1")
    vs_kwargs = dict(
        stability        = settings["stability"],
        similarity_boost = settings["similarity_boost"],
        use_speaker_boost= settings.get("speaker_boost", True),
    )
    if supports_style:
        vs_kwargs["style"] = settings.get("style", 0.0)
    vs = VoiceSettings(**vs_kwargs)

    client = ElevenLabs(api_key=api_key)
    try:
        audio = client.text_to_speech.convert(
            text           = final,
            voice_id       = voice_id,
            model_id       = model_id,
            voice_settings = vs,
            output_format  = "mp3_44100_128",
        )
        # Write inside the same try block — convert() is a lazy generator in
        # newer SDK versions, so the HTTP error only fires during iteration, NOT
        # during the convert() call above. Without this, a 403/429/etc. raises
        # an SDK ApiError outside the except block and leaks raw HTML to the UI.
        with open(out_path, "wb") as f:
            for chunk in audio:
                if chunk:
                    f.write(chunk)

    except Exception as e:
        err = str(e)
        # Strip verbose HTTP header dumps (headers: {...}, status_code: NNN, body: ...)
        if "headers:" in err or "status_code:" in err:
            import re as _re
            # Try JSON message field first
            m = _re.search(r"['\"]message['\"]\s*:\s*['\"]([^'\"]+)['\"]", err)
            # Fallback: extract bare status code
            sc = _re.search(r"status_code[:\s=]+(\d+)", err)
            if m:
                short = m.group(1)
            elif sc:
                short = f"HTTP {sc.group(1)}"
            else:
                short = "ElevenLabs API error"
            err = short

        if "403" in err or "forbidden" in err.lower():
            raise RuntimeError(
                "EL_QUOTA: ElevenLabs 403 Forbidden — voice or model not accessible.\n"
                "Likely cause: Library/shared voices require a paid plan, OR your Voice ID is wrong.\n"
                "Fix: elevenlabs.io → Voice Lab → Create Voice (Voice Design) → copy new Voice ID.\n"
                "Voice Design voices work on the free tier."
            )
        if "402" in err or "payment_required" in err or "paid_plan_required" in err:
            raise RuntimeError(
                "EL_QUOTA: ElevenLabs: You're using a Library voice — those require a paid plan.\n"
                "Fix: Go to elevenlabs.io → Voice Lab → Create Voice (Voice Design).\n"
                "Copy the new Voice ID into TTS Settings → ElevenLabs tab.\n"
                "Voice Design voices work on the free tier."
            )
        if "401" in err or "unauthorized" in err.lower():
            raise RuntimeError(f"EL_QUOTA: ElevenLabs unauthorized (bad API key?): {err}")
        if "429" in err or "rate_limit" in err.lower() or "quota" in err.lower() or "too many" in err.lower():
            raise RuntimeError(f"EL_QUOTA: ElevenLabs quota/rate-limit hit: {err}")
        raise RuntimeError(err)

    return out_path


# ── QThread worker (matches TTSWorker interface) ──────────────────────────────
class ElevenLabsWorker(QThread):
    done   = pyqtSignal(str)
    failed = pyqtSignal(str)

    def __init__(self, text: str, emotion: str = "neutral", parent=None):
        super().__init__(parent)
        self.text    = text
        self.emotion = emotion
        self.setObjectName("ElevenLabsTTS")

    def run(self):
        try:
            for old in TTS_DIR.glob("el_*.mp3"):
                try: old.unlink()
                except Exception: pass
            path = synthesize(self.text, self.emotion)
            self.done.emit(path)
        except Exception as e:
            print(f"[ElevenLabs] Error: {e}")
            self.failed.emit(str(e))
        finally:
            self.quit()


# ── Voice listing helper ──────────────────────────────────────────────────────
def list_voices() -> list[dict]:
    """Returns list of {voice_id, name} dicts from your ElevenLabs account."""
    try:
        from elevenlabs.client import ElevenLabs
        client = ElevenLabs(api_key=el_cfg().get("api_key", ""))
        voices = client.voices.get_all()
        return [{"voice_id": v.voice_id, "name": v.name} for v in voices.voices]
    except Exception as e:
        print(f"[ElevenLabs] Could not list voices: {e}")
        return []
