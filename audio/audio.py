"""
[MODULE] audio.py
[SYSTEM] ProjectDVC - Acoustic Cortex & Vocal Synthesis Engine
[AUTHOR] Abtin

The drone's auditory nervous system. Owns the pygame mixer lifecycle, generates
the procedural UI soundscape, and arbitrates between TTS engines
(ElevenLabs → edge-tts → Piper) in strict priority order.
Every syllable the companion speaks — and every click the UI makes — routes here.
"""
import asyncio, math, os, re, struct, subprocess, time, wave
from pathlib import Path
from PyQt6.QtCore import QThread, pyqtSignal
from core.config import BASE, SOUNDS_DIR, TTS_DIR
try:
    from audio.tts_elevenlabs import ElevenLabsWorker, is_configured as el_is_configured, list_voices as el_list_voices
except ImportError:
    ElevenLabsWorker = None
    def el_is_configured(): return False
    def el_list_voices(): return []

# ── TTS folder layout ─────────────────────────────────────────────────────────
#   assets/tts/           ← TTS_DIR  (defined in core.config)
#   assets/tts/voices/    ← VOICES_DIR
#   assets/tts/piper.exe  ← PIPER_EXE
#
VOICES_DIR = TTS_DIR / "voices"
PIPER_EXE  = TTS_DIR / "piper.exe"

TTS_DIR.mkdir(exist_ok=True)
VOICES_DIR.mkdir(exist_ok=True)

# ── Piper model scan ──────────────────────────────────────────────────────────
PIPER_MODELS: dict[str, str] = {}

def scan_piper_models() -> None:
    PIPER_MODELS.clear()
    # Search tts/voices/ first, then tts/ itself, then legacy locations
    search_dirs = [
        VOICES_DIR,
        TTS_DIR,
        BASE / "voices",   # legacy — in case user hasn't moved files yet
        BASE / "models",
    ]
    for d in search_dirs:
        if not d.exists():
            continue
        for f in sorted(d.glob("*.onnx")):
            path = str(f.resolve())
            PIPER_MODELS[f.stem] = path
            has_json = Path(path + ".json").exists()
            print(f"[TTS] Voice: {f.stem} -> {path}" + (" [+json]" if has_json else " [NO json]"))
    print(f"[TTS] {len(PIPER_MODELS)} voice(s) found")

scan_piper_models()

def get_voice_path(sd: dict) -> str | None:
    sel = sd.get("selected_offline_voice", "")
    if sel and sel in PIPER_MODELS:
        return PIPER_MODELS[sel]
    if PIPER_MODELS:
        name = next(iter(PIPER_MODELS))
        sd["selected_offline_voice"] = name
        return PIPER_MODELS[name]
    return None

# ── Mixer helpers ─────────────────────────────────────────────────────────────
_mixer_ready   = False
_sfx_cache:   dict = {}   # stem → pygame.mixer.Sound  (no re-create per call)
_sfx_channel        = None  # dedicated channel so SFX never touches music stream

def init_mixer() -> None:
    global _mixer_ready, _sfx_channel
    if _mixer_ready:
        return
    try:
        import pygame
        pygame.mixer.pre_init(44100, -16, 2, 1024)
        pygame.mixer.init()
        pygame.mixer.set_num_channels(16)   # extra headroom
        _sfx_channel = pygame.mixer.Channel(0)  # reserve ch-0 for UI SFX
        _mixer_ready = True
        print("[Audio] mixer initialised OK  (16 channels, ch-0 = SFX)")
    except Exception as e:
        print(f"[Audio] mixer init failed: {e}")

# ── Procedural SFX ────────────────────────────────────────────────────────────
def gen_sounds() -> None:
    SOUNDS_DIR.mkdir(exist_ok=True)
    sr = 22050

    def mk(name, freq, dur, vol=0.3, sweep=None):
        p = SOUNDS_DIR / name
        if p.exists():
            return
        n = int(sr * dur)
        samples = [
            int(max(-32767, min(32767,
                vol * math.sin(
                    2 * math.pi
                    * (freq + (sweep - freq) * (i / n) if sweep else freq)
                    * (i / sr)
                ) * (1 - i / n) * 32767
            )))
            for i in range(n)
        ]
        with wave.open(str(p), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
            w.writeframes(struct.pack(f"<{'h'*n}", *samples))

    mk("blip.wav",      600,  0.04, 0.20)
    mk("notify.wav",    880,  0.15, 0.25, sweep=440)
    mk("stat_up.wav",   523,  0.20, 0.25, sweep=1047)
    mk("stat_down.wav", 1047, 0.20, 0.25, sweep=262)
    mk("outfit.wav",    1200, 0.25, 0.20, sweep=600)
    mk("error.wav",     150,  0.30, 0.30)

gen_sounds()
init_mixer()   # initialise mixer early so first blip has no delay

def play_sfx(name: str) -> None:
    """Play a UI sound effect on the dedicated SFX channel.
    Uses cached Sound objects — never re-creates them on each call.
    Completely independent of the TTS music channel (no interference)."""
    try:
        import pygame
        if not _mixer_ready:
            return
        p = SOUNDS_DIR / name
        if not p.exists():
            return
        snd = _sfx_cache.get(name)
        if snd is None:
            snd = pygame.mixer.Sound(str(p))
            _sfx_cache[name] = snd
        if _sfx_channel is not None:
            _sfx_channel.play(snd)
        else:
            snd.play()
    except Exception:
        pass

def stop_audio() -> None:
    """Stop TTS playback. Does NOT touch the SFX channel."""
    try:
        import pygame
        if not _mixer_ready:
            return
        if pygame.mixer.music.get_busy():
            pygame.mixer.music.stop()
        try:
            pygame.mixer.music.unload()
        except Exception:
            pass
    except Exception:
        pass

def play_audio(fp: str) -> None:
    """Play a TTS audio file on the music channel. SFX channel is untouched."""
    try:
        import pygame
        init_mixer()
        if pygame.mixer.music.get_busy():
            pygame.mixer.music.stop()
        try:
            pygame.mixer.music.unload()
        except Exception:
            pass
        pygame.mixer.music.load(fp)
        pygame.mixer.music.play()
    except Exception as e:
        print(f"[Audio] {e}")

# ── TTS Worker ────────────────────────────────────────────────────────────────
# Priority: ElevenLabs (if configured) → edge-tts (online) → piper (offline)
class TTSWorker(QThread):
    done   = pyqtSignal(str)
    failed = pyqtSignal(str)

    def __init__(self, text, engine="online", voice="en-US-AriaNeural",
                 model_path=None, emotion="neutral", parent=None):
        super().__init__(parent)
        self.text, self.engine, self.voice, self.mp = text, engine, voice, model_path
        self.emotion = emotion  # passed from companion so ElevenLabs knows how to sound

    def run(self):
        clean = re.sub(r"\*[^*]+\*", "", self.text)
        clean = re.sub(r"\[.*?\]",   "", clean)
        clean = re.sub(r"[^\w\s.,!?'\-]", "", clean).strip()
        if not clean:
            self.failed.emit("empty"); return
        try:
            # Respect explicit engine selection — ElevenLabs only when chosen
            if self.engine == "elevenlabs" and el_is_configured() and ElevenLabsWorker:
                self._elevenlabs(clean)
            elif self.engine == "online":
                self._edge(clean)
            else:
                self._piper(clean)
        except Exception as e:
            self.failed.emit(str(e))

    def _elevenlabs(self, text: str) -> None:
        from audio.tts_elevenlabs import synthesize
        # Clean up old ElevenLabs files
        for old in TTS_DIR.glob("el_*.mp3"):
            try: old.unlink()
            except Exception: pass
        try:
            out = synthesize(text, self.emotion)
            self.done.emit(out)
        except RuntimeError as e:
            err = str(e)
            # EL_QUOTA: prefix means quota/auth error — fall back to edge-tts silently
            if err.startswith("EL_QUOTA:"):
                print(f"[TTS] ElevenLabs quota/auth error — falling back to edge-tts: {err[9:].strip()[:80]}")
                try:
                    self._edge(text)
                except Exception as fallback_err:
                    # edge-tts also failed — try piper as last resort
                    print(f"[TTS] edge-tts fallback also failed: {fallback_err}")
                    if self.mp:
                        try: self._piper(text)
                        except Exception: self.failed.emit(err)
                    else:
                        self.failed.emit(err)
            else:
                raise  # re-raise non-quota errors normally

    def _edge(self, text: str) -> None:
        import edge_tts
        out = str(TTS_DIR / "speech.mp3")
        async def _go():
            await edge_tts.Communicate(text, self.voice).save(out)
        asyncio.run(_go())
        self.done.emit(out)

    def _piper(self, text: str) -> None:
        out = str(TTS_DIR / f"speech_{int(time.time()*1000) % 99999}.wav")
        if not self.mp or not os.path.exists(self.mp):
            self.failed.emit("No model"); return
        stop_audio()
        for old in TTS_DIR.glob("speech_*.wav"):
            try: old.unlink()
            except Exception: pass
        exe = None
        for candidate in [PIPER_EXE, BASE / "piper.exe"]:
            if candidate.exists():
                exe = str(candidate); break
        if not exe:
            exe = "piper"
        try:
            subprocess.run(
                [exe, "--model", self.mp, "--output_file", out],
                input=text.encode(), timeout=30, check=True,
                capture_output=True, cwd=str(TTS_DIR),
            )
            self.done.emit(out)
        except Exception as e:
            print(f"[TTS] Piper error: {e}")
            self.failed.emit("Piper failed.")
