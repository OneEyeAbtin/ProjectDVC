"""
[MODULE] save.py
[SYSTEM] ProjectDVC — Save data I/O layer. Loads user state from the unified
         dvc_profile.json, writes mutations back atomically, and manages
         traits.txt for the memory cortex.
[AUTHOR] Abtin
"""
import json
from core.config import PROFILE_PATH, TRAITS_PATH, _DEFAULTS

# DEFAULT_SAVE is the user-data portion of the defaults
DEFAULT_SAVE: dict = {k: _DEFAULTS[k] for k in [
    "user_name","pet_name","persona","outfit","brain_mode","stats",
    "tts_enabled","tts_engine","lip_sync_tts","lip_sync_text",
    "selected_offline_voice","hearts_visible","setup_complete","setup_answers",
    "last_emotion","theme",
]}
DEFAULT_SAVE["stats"] = dict(_DEFAULTS["stats"])

def load_save() -> dict:
    """Load the full profile and return a dict containing save-data keys."""
    from core.config import CONFIG
    sd = {}
    for k, v in DEFAULT_SAVE.items():
        sd[k] = CONFIG.get(k, v)
    # Also include any extra keys that might be in the profile
    for k in CONFIG:
        if k not in sd and not isinstance(CONFIG[k], dict) or k in ("setup_answers",):
            sd[k] = CONFIG[k]
    return sd

def persist_save(data: dict) -> None:
    """Write save-data keys back into the unified profile and flush to disk."""
    from core.config import CONFIG
    CONFIG.update(data)
    with open(PROFILE_PATH,"w",encoding="utf-8") as f:
        import json; json.dump(CONFIG,f,indent=2,ensure_ascii=False)

def load_traits() -> list[str]:
    if TRAITS_PATH.exists():
        with open(TRAITS_PATH,"r",encoding="utf-8") as f:
            return [l.strip() for l in f if l.strip()]
    return []

def save_traits(traits: list[str]) -> None:
    with open(TRAITS_PATH,"w",encoding="utf-8") as f:
        f.write("\n".join(traits)+"\n")
