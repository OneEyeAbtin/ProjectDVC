"""
[MODULE] stt.py
[SYSTEM] ProjectDVC - Speech Ingestion & Transcription Pipeline
[AUTHOR] Abtin

Captures raw mic audio, resamples to 16kHz, and transcribes via Groq Whisper
(online) or faster-whisper (offline, CPU-only). Runs on a dedicated QThread —
the UI mic button arms/disarms the recording gate. Engine and gain are
hot-reloaded from config.json with no restart required.
"""

import io, os, tempfile, threading, wave
import numpy as np
from pathlib import Path
from PyQt6.QtCore import QThread, pyqtSignal
from core.config import CONFIG, BASE

# ── Config helpers ────────────────────────────────────────────────────────────
def stt_cfg() -> dict:
    return CONFIG.get("stt", {})

def stt_engine() -> str:
    return stt_cfg().get("engine", "groq")

def is_groq_configured() -> bool:
    # Re-uses the same Groq key from online_api_key
    return bool(CONFIG.get("online_api_key", "") and
                CONFIG.get("online_api_key") != "YOUR-API-KEY-HERE")

# ── Audio recorder ────────────────────────────────────────────────────────────
MIC_GAIN    = 4.0   # default fallback — overridden by CONFIG["stt"]["mic_gain"] at runtime
SAMPLE_RATE = 16000   # Whisper expects 16kHz
CHANNELS    = 1

def get_mic_gain() -> float:
    """Read gain from config so the settings slider applies without restart."""
    return float(CONFIG.get("stt", {}).get("mic_gain", MIC_GAIN))

class AudioRecorder:
    """Records mic audio into a numpy buffer. Start/stop controlled externally."""

    def __init__(self):
        self._frames       : list[np.ndarray] = []
        self._recording    : bool             = False
        self._lock          = threading.Lock()
        self._stream        = None
        self._latest_peak  : float            = 0.0   # for live VU meter

    def start(self, device_index=None) -> bool:
        try:
            import sounddevice as sd
            self._frames   = []
            self._recording = True

            # Query device's native sample rate to avoid PaErrorCode -9997
            dev_info = sd.query_devices(device_index or sd.default.device[0])
            native_rate = int(dev_info.get("default_samplerate", 44100))
            self._capture_rate = native_rate
            print(f"[STT] Device native rate: {native_rate} Hz")

            self._stream = sd.InputStream(
                samplerate  = native_rate,
                channels    = CHANNELS,
                dtype       = "int16",
                callback    = self._cb,
                device      = device_index,
            )
            self._stream.start()
            print("[STT] Recording started")
            return True
        except Exception as e:
            print(f"[STT] Could not start mic: {e}")
            return False

    def stop(self) -> np.ndarray | None:
        self._recording = False
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        with self._lock:
            if not self._frames:
                return None
            audio = np.concatenate(self._frames, axis=0).flatten()
            capture_rate = getattr(self, '_capture_rate', SAMPLE_RATE)
            # Resample to 16kHz if needed (Whisper requires exactly 16kHz)
            if capture_rate != SAMPLE_RATE:
                try:
                    from scipy.signal import resample_poly
                    from math import gcd
                    g = gcd(SAMPLE_RATE, capture_rate)
                    up, down = SAMPLE_RATE // g, capture_rate // g
                    audio = resample_poly(audio.astype(np.float32), up, down).astype(np.int16)
                    print(f"[STT] Resampled {capture_rate}→{SAMPLE_RATE} Hz")
                except Exception as e:
                    print(f"[STT] Resample failed ({e}), using raw audio")
            print(f"[STT] Recorded {len(audio)/SAMPLE_RATE:.1f}s of audio")
            return audio

    def _cb(self, indata, frames, time_info, status):
        if self._recording:
            gain = get_mic_gain()
            boosted = np.clip(indata.astype(np.float32) * gain,
                              -32768, 32767).astype(np.int16)
            with self._lock:
                self._frames.append(boosted)
                self._latest_peak = float(np.abs(boosted).max()) / 32768.0

    def to_wav_bytes(self, audio: np.ndarray) -> bytes:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(CHANNELS)
            wf.setsampwidth(2)   # int16 = 2 bytes
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(audio.tobytes())
        return buf.getvalue()

# ── STT Worker ────────────────────────────────────────────────────────────────
class STTWorker(QThread):
    result  = pyqtSignal(str)   # transcribed text
    failed  = pyqtSignal(str)   # error message
    started_recording = pyqtSignal()
    stopped_recording = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.recorder  = AudioRecorder()
        self._running  = False
        self._stop_evt = threading.Event()

    def run(self):
        self._stop_evt.clear()
        ok = self.recorder.start()
        if not ok:
            self.failed.emit("Could not access microphone.\nInstall sounddevice: pip install sounddevice")
            return
        self.started_recording.emit()
        # Wait until stop() is called externally
        self._stop_evt.wait()
        self.stopped_recording.emit()
        audio = self.recorder.stop()
        if audio is None or len(audio) < SAMPLE_RATE * 0.3:
            self.failed.emit("Recording too short")
            return
        wav_bytes = self.recorder.to_wav_bytes(audio)
        try:
            eng = stt_engine()
            if eng == "groq":
                text = self._transcribe_groq(wav_bytes)
            else:
                text = self._transcribe_local(audio)
            if text:
                self.result.emit(text.strip())
            else:
                self.failed.emit("No speech detected")
        except Exception as e:
            self.failed.emit(str(e))

    def stop_recording(self):
        """Called from UI when user clicks mic button again."""
        self._stop_evt.set()

    # ── Groq Whisper ──────────────────────────────────────────────────────────
    def _transcribe_groq(self, wav_bytes: bytes) -> str:
        import requests
        key = CONFIG.get("online_api_key", "")
        if not key or key == "YOUR-API-KEY-HERE":
            raise RuntimeError("No Groq API key set in config.json")
        url = "https://api.groq.com/openai/v1/audio/transcriptions"
        model = stt_cfg().get("groq_model", "")
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {key}"},
            files={"file": ("audio.wav", wav_bytes, "audio/wav")},
            data={"model": model, "response_format": "text"},
            timeout=30,
        )
        resp.raise_for_status()
        # Groq returns plain text when response_format=text
        return resp.text.strip()

    # ── Local Whisper (via faster-whisper — no PyTorch needed) ──────────────
    def _transcribe_local(self, audio: np.ndarray) -> str:
        """
        Uses faster-whisper (ctranslate2 backend).
        No PyTorch, no DLL issues, same quality as openai-whisper.
        Install: pip install faster-whisper
        """
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            raise RuntimeError(
                "faster-whisper not installed.\n"
                "Run: py -3.12 -m pip install faster-whisper"
            )

        model_name = stt_cfg().get("local_model", "base")
        print(f"[STT] Loading faster-whisper model: {model_name} (CPU)")

        # Load model — downloads on first use, cached after
        model = WhisperModel(
            model_name,
            device="cpu",
            compute_type="int8",   # lightest, works on any CPU
        )

        # Convert int16 → float32 for faster-whisper
        audio_f = audio.astype(np.float32) / 32768.0

        # Transcribe
        segments, info = model.transcribe(audio_f, beam_size=5, language="en")
        text = " ".join(seg.text for seg in segments).strip()
        print(f"[STT] Transcribed ({info.language}, {info.duration:.1f}s): {text[:60]}")
        return text
