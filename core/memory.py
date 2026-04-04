"""
[MODULE] memory.py
[SYSTEM] ProjectDVC — Tiered memory cortex. Deduplicates and classifies learned
         traits into permanent/session tiers, compresses chat history into a
         summary paragraph asynchronously on next boot, and builds the full
         MEMORY block injected into the AI system prompt each turn.
[AUTHOR] Abtin

Copyright (c) 2026 Abtin (github.com/OneEyeAbtin). All rights reserved.
This code may not be copied, modified, or distributed without permission.
"""

import json, re, threading, difflib
from pathlib import Path
from core.config import BASE, CONFIG

# ═════════════════════════════════════════════════════════════════════════════
# SESSION CACHE FILE  (separate from save_data.json — raw history only)
# ═════════════════════════════════════════════════════════════════════════════
_CACHE_FILE = BASE / "data" / "session_cache.json"

def save_session_cache(hist: list) -> None:
    """
    Save raw chat history to a separate file on close.
    Fast — no API call, just a JSON dump.
    """
    if not hist: return
    try:
        with open(_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({"messages": hist}, f, ensure_ascii=False)
        print(f"[MEM] Session cache saved ({len(hist)} messages)")
    except Exception as e:
        print(f"[MEM] Cache save failed: {e}")

def load_session_cache() -> list | None:
    """Load raw history from cache file. Returns None if not found."""
    if not _CACHE_FILE.exists():
        return None
    try:
        with open(_CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        msgs = data.get("messages", [])
        return msgs if msgs else None
    except Exception:
        return None

def delete_session_cache() -> None:
    """Delete the cache file once compressed."""
    try:
        if _CACHE_FILE.exists():
            _CACHE_FILE.unlink()
    except Exception:
        pass

def has_session_cache() -> bool:
    return _CACHE_FILE.exists() and _CACHE_FILE.stat().st_size > 10



# ── Storage keys inside save_data.json ───────────────────────────────────────
_KEY_SESSION_SUM  = "session_summary"    # compressed summary of last session
_KEY_RAW_HIST     = "_raw_hist_pending"  # raw history saved for lazy compress
_KEY_PERM_TRAITS  = "_perm_traits"       # list of permanent trait strings
_KEY_SESSION_TRAITS = "_sess_traits"     # list of session-only trait strings

# ── Tier prefixes — traits starting with these are always permanent ───────────
_PERM_PREFIXES = (
    "user's user name",
    "user's pet name",
    "user's age",
    "user's pronouns",
    "user's hobby",
    "user's love language",
    "user's humor style",
    "user's music taste",
    "user's social type",
    "user's fear",
    "user's life motto",
    "user's deep wish",
    "user's dream superpower",
    "user's desired role",
    "user's friendship value",
    "user's guilty pleasure",
    "user's comfort media",
    "user's emotional response",
    "user's schedule",
    "user's pet peeve",
)

# ── Similarity threshold for deduplication (0-1) ─────────────────────────────
_DEDUP_THRESHOLD = 0.82

# ═════════════════════════════════════════════════════════════════════════════
# 1 + 2 — TRAIT DEDUP + TIERED SPLIT
# ═════════════════════════════════════════════════════════════════════════════

def dedup_traits(traits: list[str]) -> list[str]:
    """
    Remove near-duplicate traits using sequence matching.
    Keeps the longer/more specific version when two are very similar.
    Also strips empty strings.
    """
    cleaned: list[str] = []
    for t in traits:
        t = t.strip()
        if not t:
            continue
        # Check similarity against everything already kept
        is_dup = False
        for i, kept in enumerate(cleaned):
            ratio = difflib.SequenceMatcher(None, t.lower(), kept.lower()).ratio()
            if ratio >= _DEDUP_THRESHOLD:
                # Keep whichever is longer (more specific)
                if len(t) > len(kept):
                    cleaned[i] = t
                is_dup = True
                break
        if not is_dup:
            cleaned.append(t)
    return cleaned

# Alias for backward compat
deduplicate_traits = dedup_traits


def split_tiers(traits: list[str]) -> tuple[list[str], list[str]]:
    """
    Split traits into (permanent, session) based on prefix matching.
    Permanent = setup answers + core facts.
    Session   = things learned during conversation.
    """
    permanent, session = [], []
    for t in traits:
        tl = t.lower()
        if any(tl.startswith(p) for p in _PERM_PREFIXES):
            permanent.append(t)
        else:
            session.append(t)
    return permanent, session


def rotate_session_traits(traits: list[str], max_session: int = 30) -> list[str]:
    """
    Keep all permanent traits but cap session traits at max_session.
    Oldest session traits are dropped first.
    """
    perm, sess = split_tiers(traits)
    if len(sess) > max_session:
        sess = sess[-max_session:]  # keep most recent
    return perm + sess


def build_memory_section(traits: list[str]) -> str:
    """Format traits into a compact bullet block for the system prompt."""
    if not traits:
        return "None yet."
    perm, sess = split_tiers(traits)
    parts = []
    if perm:
        parts.append("PROFILE:\n" + "\n".join(f"- {t}" for t in perm))
    if sess:
        parts.append("LEARNED:\n" + "\n".join(f"- {t}" for t in sess))
    return "\n".join(parts) if parts else "None yet."


# ═════════════════════════════════════════════════════════════════════════════
# 3 — EMOTION PERSISTENCE
# ═════════════════════════════════════════════════════════════════════════════

def save_emotion(sd: dict, emotion: str) -> None:
    """Called whenever emotion changes — stored in save_data."""
    sd["last_emotion"] = emotion


def restore_emotion(sd: dict) -> str:
    """Returns last saved emotion, validated against emotion list."""
    saved = sd.get("last_emotion", "neutral")
    valid = CONFIG.get("emotions", ["neutral"])
    return saved if saved in valid else "neutral"


# ═════════════════════════════════════════════════════════════════════════════
# 4 — SESSION SUMMARY  (blocking, called on clean close)
# ═════════════════════════════════════════════════════════════════════════════

def generate_session_summary(
    hist: list[dict],
    pet_name: str,
    user_name: str,
    url: str, key: str, model: str,
) -> str | None:
    """
    Ask the model to write a 2-3 sentence summary of the session.
    Returns the summary string or None on failure.
    Only called when there are enough messages to bother.
    """
    if not hist or not url or not key or key == "YOUR-API-KEY-HERE":
        return None
    # Build a condensed transcript (just the last 20 messages)
    lines = []
    for m in hist[-20:]:
        role = user_name if m["role"] == "user" else pet_name
        lines.append(f"{role}: {m['content'][:120]}")
    transcript = "\n".join(lines)

    prompt = (
        f"Summarize this conversation between {user_name} and {pet_name} "
        f"in 2-3 sentences. Focus on what they talked about, any emotional "
        f"moments, and anything important that happened. Be concise.\n\n"
        f"CONVERSATION:\n{transcript}\n\nSUMMARY:"
    )
    try:
        import requests
        headers = {"Content-Type": "application/json"}
        if key:
            headers["Authorization"] = f"Bearer {key}"
        r = requests.post(
            url,
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.4,
                "max_tokens": 120,
            },
            headers=headers,
            timeout=15,
        )
        r.raise_for_status()
        text = r.json()["choices"][0]["message"]["content"].strip()
        print(f"[MEM] Session summary: {text[:80]}...")
        return text
    except Exception as e:
        print(f"[MEM] Summary failed: {e}")
        return None


# ═════════════════════════════════════════════════════════════════════════════
# 5 — LAZY COMPRESSION  (async, called on next boot)
# ═════════════════════════════════════════════════════════════════════════════

def save_session(sd: dict, hist: list, last_msg: str, emo: str) -> None:
    """
    Save raw session data to sd for lazy compression next boot.
    Called from _close() so it's instant — no API call.
    """
    if len(hist) >= 4:  # only bother if there was a real conversation
        sd[_KEY_RAW_HIST] = {
            "messages":  hist[-20:],  # keep last 20
            "last_msg":  last_msg,
            "emotion":   emo,
        }
    sd["last_emotion"] = emo


def has_pending_history(sd: dict) -> bool:
    """True if there's unsummarized raw history waiting."""
    return bool(sd.get(_KEY_RAW_HIST))


def pop_raw_history(sd: dict) -> dict | None:
    """Remove and return the pending raw history block."""
    return sd.pop(_KEY_RAW_HIST, None)


def restore_raw_history(sd: dict, raw: dict) -> None:
    """Put raw_history back into sd if compression failed, so it survives restart."""
    if raw:
        sd[_KEY_RAW_HIST] = raw


def compress_session_async(
    sd: dict,
    raw: dict,
    pet_name: str,
    user_name: str,
    on_done: callable = None,
    on_fail: callable = None,
) -> None:
    """
    Run session summary in a background thread.
    Reads API config from CONFIG automatically.
    on_done(summary) called on success, on_fail(err) on failure.
    """
    from core.config import CONFIG
    bm  = sd.get("brain_mode", "local")
    url = CONFIG.get("online_api_url" if bm=="online" else "local_api_url", "")
    key = CONFIG.get("online_api_key" if bm=="online" else "local_api_key", "")
    mdl = CONFIG.get("online_api_model" if bm=="online" else "local_api_model", "")

    def _run():
        try:
            hist = raw.get("messages", []) if isinstance(raw, dict) else raw
            summary = generate_session_summary(hist, pet_name, user_name, url, key, mdl)
            if summary:
                sd[_KEY_SESSION_SUM] = summary
                sd.pop(_KEY_RAW_HIST, None)
                if on_done: on_done(summary)
            else:
                if on_fail: on_fail("No summary generated")
        except Exception as e:
            if on_fail: on_fail(str(e))

    threading.Thread(target=_run, daemon=True, name="mem_compress").start()



# ═════════════════════════════════════════════════════════════════════════════
# TRAIT COMPRESSION  — squash many learned traits into dense sentences
# ═════════════════════════════════════════════════════════════════════════════

_COMPRESS_THRESHOLD = 25   # compress session traits when this many accumulate

def needs_trait_compression(traits: list[str]) -> bool:
    """True if session traits have grown large enough to compress."""
    _, sess = split_tiers(traits)
    return len(sess) >= _COMPRESS_THRESHOLD

def compress_traits(
    traits: list[str],
    pet_name: str,
    user_name: str,
    url: str,
    key: str,
    model: str,
) -> list[str]:
    """
    Ask the model to rewrite session traits as 4-6 compact sentences.
    Returns: permanent traits unchanged + compressed session traits as new entries.
    Falls back to original traits on any failure.
    """
    perm, sess = split_tiers(traits)
    if len(sess) < 5:
        return traits  # not worth compressing

    bullet_list = "\n".join(f"- {t}" for t in sess)
    prompt = (
        f"The following are facts learned about {user_name} during conversations "
        f"with their AI companion {pet_name}.\n\n"
        f"Rewrite these as 4-6 compact, information-dense sentences. "
        f"Keep ALL facts. Remove redundancy. Be concise.\n\n"
        f"FACTS:\n{bullet_list}\n\nCOMPRESSED:"
    )
    try:
        import requests
        headers = {"Content-Type": "application/json"}
        if key: headers["Authorization"] = f"Bearer {key}"
        r = requests.post(
            url,
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
                "max_tokens": 200,
            },
            headers=headers,
            timeout=20,
        )
        r.raise_for_status()
        compressed_text = r.json()["choices"][0]["message"]["content"].strip()
        # Split compressed text back into list entries
        compressed_traits = [
            f"[compressed] {line.strip().lstrip('- ')}"
            for line in compressed_text.splitlines()
            if line.strip()
        ]
        print(f"[MEM] Traits compressed: {len(sess)} → {len(compressed_traits)}")
        return perm + compressed_traits
    except Exception as e:
        print(f"[MEM] Trait compression failed: {e}")
        return traits  # fall back silently

def compress_traits_async(
    traits: list[str],
    sd: dict,
    on_done: callable = None,
) -> None:
    """
    Compress traits in a background thread. Updates traits file when done.
    on_done(new_traits) called on success.
    """
    from core.config import CONFIG
    bm  = sd.get("brain_mode", "local")
    url = CONFIG.get("online_api_url" if bm == "online" else "local_api_url", "")
    key = CONFIG.get("online_api_key" if bm == "online" else "local_api_key", "")
    mdl = CONFIG.get("online_api_model" if bm == "online" else "local_api_model", "")

    def _run():
        new_traits = compress_traits(
            traits,
            sd.get("pet_name", "Companion"),
            sd.get("user_name", "User"),
            url, key, mdl,
        )
        if on_done: on_done(new_traits)

    threading.Thread(target=_run, daemon=True, name="trait_compress").start()

# ═════════════════════════════════════════════════════════════════════════════
# SYSTEM PROMPT BUILDER — used by _sys_prompt in main.py
# ═════════════════════════════════════════════════════════════════════════════

def build_memory_prompt(sd: dict, traits: list[str]) -> str:
    """
    Build the full MEMORY block for the system prompt.
    Includes: setup answers, permanent traits, session traits, last summary.
    """
    parts = []

    # Setup answers (permanent profile)
    sa = sd.get("setup_answers", {})
    if sa:
        lines = "\n".join(f"- {k.replace('_',' ')}: {v}"
                          for k, v in sa.items() if v and v != "skip")
        if lines:
            parts.append(f"PROFILE:\n{lines}")

    # Learned traits — split by tier
    perm, sess = split_tiers(traits)
    # Remove anything already in setup_answers to avoid duplication
    sa_vals = {str(v).lower() for v in sa.values()}
    perm = [t for t in perm if not any(
        sv in t.lower() for sv in sa_vals if len(sv) > 3
    )]
    if perm:
        parts.append("PERMANENT FACTS:\n" + "\n".join(f"- {t}" for t in perm[:20]))
    if sess:
        parts.append("RECENT LEARNED:\n" + "\n".join(f"- {t}" for t in sess[-15:]))

    # Last session summary
    summary = sd.get(_KEY_SESSION_SUM, "")
    if summary:
        parts.append(f"LAST SESSION:\n{summary}")

    return "\n\n".join(parts) if parts else "None yet."


# ── legacy alias used in a few older call sites ───────────────────────────────
def load_session(sd: dict) -> dict | None:
    return sd.get(_KEY_RAW_HIST)

def has_session(sd: dict) -> bool:
    return has_pending_history(sd)

def delete_session(sd: dict) -> None:
    sd.pop(_KEY_RAW_HIST, None)

def compress_session(
    hist: list,
    url: str, key: str, model: str,
    pet_name: str = "Companion",
    user_name: str = "User",
) -> str | None:
    """Blocking version — used when called directly."""
    return generate_session_summary(hist, pet_name, user_name, url, key, model)

def format_memory_block(traits: list[str]) -> str:
    return build_memory_section(traits)

# ── System prompt block builder ───────────────────────────────────────────────

def build_memory_prompt(sd: dict, session_traits: list[str]) -> str:
    """Builds the MEMORY section of the system prompt from all tiers."""
    parts = []

    # Setup profile (one-time answers, very compact)
    sa = sd.get("setup_answers", {})
    if sa:
        answers = "; ".join(f"{k.replace('_',' ')}: {v}" for k, v in sa.items() if v and v != "skip")
        parts.append(f"Profile: {answers}")

    # Permanent long-term facts
    pf = load_permanent()
    if pf:
        parts.append("Permanent facts:\n" + "\n".join(f"  - {f}" for f in pf))
    else:
        parts.append("Permanent facts: None yet.")

    # Session-scoped notes (this session only, from traits.txt)
    if session_traits:
        # Filter out setup-answer duplicates
        sa_vals = set(str(v).lower() for v in sa.values())
        filtered = [t for t in session_traits if t.split(": ")[-1].lower() not in sa_vals]
        if filtered:
            parts.append("This session notes:\n" + "\n".join(f"  - {t}" for t in filtered[-10:]))

    # Last session summary (compressed from previous conversation)
    summary = sd.get(_KEY_SESSION_SUM, "")
    if summary:
        parts.append(f"Last session:\n  {summary}")

    return "\n".join(parts)


# load_session_cache now defined above in SESSION CACHE FILE section

# ═════════════════════════════════════════════════════════════════════════════
# PERMANENT FACTS  — high-importance facts stored separately from session traits
# ═════════════════════════════════════════════════════════════════════════════

_PERM_FILE = BASE / "data" / "permanent_facts.json"

def load_permanent() -> list[str]:
    """Load permanent long-term facts from disk."""
    if not _PERM_FILE.exists():
        return []
    try:
        with open(_PERM_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def save_permanent(facts: list[str]) -> None:
    """Save permanent facts to disk."""
    try:
        with open(_PERM_FILE, "w", encoding="utf-8") as f:
            json.dump(facts, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[MEM] Permanent save failed: {e}")

def add_permanent_fact(fact: str, existing: list[str]) -> list[str]:
    """Add a fact to the permanent list, dedup, save, return updated list."""
    updated = dedup_traits(existing + [fact])
    save_permanent(updated)
    return updated

def classify_trait(trait: str) -> str:
    """
    Return 'permanent' if this trait is important enough to store permanently,
    'session' otherwise.
    Permanent = core identity facts (name, preferences, backstory).
    Session   = passing observations, mood-based comments.
    """
    tl = trait.lower()
    # Permanent indicators
    perm_keywords = [
        "name", "age", "pronoun", "hobby", "passion", "love language",
        "humor", "fear", "motto", "superpower", "music", "schedule",
        "introvert", "extrovert", "pet peeve", "comfort", "wish",
        "friendship", "guilty pleasure", "role", "job", "major", "study",
    ]
    if any(k in tl for k in perm_keywords):
        return "permanent"
    # Short facts about preferences/identity also permanent
    if len(trait) < 80 and any(w in tl for w in ["likes","loves","hates","prefers","always","never","is a","was a"]):
        return "permanent"
    return "session"

