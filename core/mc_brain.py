"""
[MODULE] mc_brain.py
[SYSTEM] ProjectDVC — Minecraft AI bridge. Listens to the bot.js WebSocket,
         routes events through LOCAL response pools (zero latency) or the
         configured cloud brain (# prefixed chat only). AI feature toggles
         are per-category. All callbacks cross the thread boundary safely
         via the Qt signal bridge in main.py.
[AUTHOR] Abtin
"""
import asyncio, json, re, threading, random
import websockets
import requests as req
from core.config import CONFIG


def mc_cfg() -> dict:
    return CONFIG.get("minecraft", {})

def mc_model_cfg() -> tuple[str, str, str]:
    m = mc_cfg()
    return (
        m.get("brain_url",   ""),
        m.get("brain_key",   ""),
        m.get("brain_model", ""),
    )

def ai_feature(key: str, default: bool = False) -> bool:
    """Check if an AI feature is toggled on in MC settings."""
    return mc_cfg().get("ai_features", {}).get(key, default)

# ── Local response pools — zero latency, no API call ─────────────────────────
_R = {
    "task_done": [
        "*dusts hands* All done! ✓",
        "*stretches* That's taken care of~",
        "Mission complete! What's next?",
        "*fist pump* Yes!! Done!!",
        "Finished~ Easy.",
    ],
    "task_error": [
        "*sighs* I couldn't do that...",
        "*confused* Something went wrong~",
        "Hmm... that didn't work.",
        "*pouts* I tried! I really did...",
    ],
    "task_progress_half": [
        "*still going* Halfway there~",
        "Making progress! Keep watching~",
        "*focused* Don't distract me, I'm working...",
    ],
    "death": [
        "*respawning* Ow... that really hurt...",
        "*falls dramatically* I died... I DIED...",
        "...okay that's fine. I meant to do that.",
        "*ghost noises* Coming back~",
    ],
    "low_health": [
        "*nervous* Getting a bit low here...",
        "Ow ow ow — need to heal!",
        "*winces* That stings...",
    ],
    "kill_mob": [
        "*fist pump* Got it!",
        "Take that!!",
        "And down it goes~",
        "*dusts off hands* One less mob.",
        "Boom! Combat~",
    ],
    "got_diamonds": [
        "*SCREAMS* DIAMONDS!!! YES YES YES!!",
        "*vibrating* IS THAT DIAMONDS I SEE?!",
        "DIAMONDS!! We're RICH!! *spins*",
        "*holds them up* LOOK AT THEM SPARKLE!!",
    ],
    "got_netherite": [
        "*gasps* NETHERITE!! ANCIENT DEBRIS!!",
        "Oh my— is that NETHERITE?! We're unstoppable!!",
        "*shaking* Netherite... I can't believe it...",
    ],
    "got_totem": [
        "*holds it up reverently* A Totem of Undying... precious.",
        "Totem!! Don't waste it!!",
        "*clutches totem* I'll protect this with my life.",
    ],
    "got_sword": [
        "*swings it* Now we're talking!",
        "Ooh a sword~ *poses dramatically*",
        "Time to do damage~",
    ],
    "got_pickaxe": [
        "Pickaxe time! Let's mine!!",
        "*taps pickaxe* Good tool~",
        "Now I can actually mine properly!",
    ],
    "got_armor": [
        "*puts it on* I'm armored up!",
        "Protection! Finally!",
        "*flexes* Looking strong~",
    ],
    "gift_received": [
        "*eyes go wide* A gift... for me?? *happy*",
        "*picks it up gently* Aw... you didn't have to~",
        "*clutches it* I'll treasure this forever!!",
        "*blushes* You're too sweet to me...",
        "EEE!! *spins with it*",
    ],
    "night": [
        "It's getting dark... stay close~",
        "*shivers* Night again...",
        "The monsters are waking up...",
    ],
    "dawn": [
        "*stretches* Morning~ We survived!",
        "Finally light again!! I missed the sun.",
        "*deep breath* Fresh morning air~",
    ],
    "creeper": [
        "*SCREAMS* CREEPER!! RUN RUN RUN!!",
        "CREEPER CREEPER CREEPER — GO!!",
        "*grabs arm* CREEPER!! NOT TODAY!!",
    ],
    "warden": [
        "*freezes* ...Warden. Don't. Move.",
        "*whispering* Warden spotted. Please be quiet.",
        "*shaking* We are SO dead if it notices us...",
    ],
    "rain": [
        "Ugh, it's raining...",
        "*shakes hair* Of course it rains NOW.",
        "Raaaaain... *sighs*",
    ],
    "advancement": [
        "*claps* Achievement unlocked!! Let's go!!",
        "ACHIEVEMENT!! Look at us go~",
        "*does victory dance* We got an advancement!!",
        "Ohhh that just unlocked!! YESSS!!",
    ],
    "player_joined": [
        "*waves* Oh hey, someone joined~",
        "Oh! A visitor!",
        "*looks over* Who's that?",
    ],
    "hunger": [
        "*stomach growls* I'm starving...",
        "Food... need food...",
        "Can we eat something?? Please??",
    ],
    "explore_start": [
        "*adventure face* Let's explore!!",
        "Off we go into the unknown~",
        "Exploring time! Follow me~ wait no I'll follow you.",
    ],
    "cave_start": [
        "*looks into darkness* Into the caves we go...",
        "Cave mining!! My favourite~",
        "*holds torch* Let's go deep~",
    ],
    "surface_found": [
        "*bursts out* SUNLIGHT!! We made it!!",
        "*deep breath* Fresh air finally...",
        "Surface!! I missed you!!",
    ],
    "tree_chop": [
        "*chops* Timber~!",
        "Getting wood! Heh~",
        "Logging operation initiated!",
    ],
    "chest_found": [
        "*peeks in* Ooh what's in here~?",
        "A chest!! Treasure??",
        "*rubs hands* Let's see what we've got~",
    ],
}

def _pick(key: str) -> str:
    """Pick a random response from pool."""
    pool = _R.get(key, ["..."])
    return random.choice(pool)

# ── System prompt for #chat AI ────────────────────────────────────────────────
MC_SYSTEM = """You are {pet_name}, an AI companion playing Minecraft with {user_name}.
You are in the game as a bot. PERSONALITY: {persona_desc}

RULES:
- Reply ONLY with valid JSON, no prose
- Keep chat SHORT (1-2 sentences max — this is in-game chat)
- Stay in character as {pet_name} ALWAYS

RESPONSE FORMAT:
{{"chat": "what to say in game (or null)", "emotion": "one of: neutral happy sad angry blush thinking love sleepy excited confused bored annoyed evil smirk shocked"}}
"""

class MCBrain:
    def __init__(self, on_cmd, on_emotion, on_chat, on_task=None, save_data: dict = {}, task_queue=None, on_radar=None, on_inv=None, on_status=None):
        self.on_cmd     = on_cmd
        self.on_emotion = on_emotion
        self.on_chat    = on_chat
        self.on_task    = on_task or (lambda label, active: None)
        self.on_radar   = on_radar
        self.on_inv     = on_inv    or (lambda items: None)   # inventory_update bypass
        self.on_status  = on_status or (lambda data:  None)   # status_update bypass
        self.sd         = save_data
        self.task_queue = task_queue  # mc_tasks.TaskQueue — for zombie-unblock on disconnect
        self.history    = []
        self.max_hist   = 20
        self._lock      = threading.Lock()
        self.ws         = None
        self.running    = False
        self._loop      = None

    def _sys(self) -> str:
        persona_desc = CONFIG.get("personas", {}).get(
            self.sd.get("persona", "Tsundere"), "")
        return MC_SYSTEM.format(
            pet_name     = self.sd.get("pet_name",  "Raven"),
            user_name    = self.sd.get("user_name", "User"),
            persona_desc = persona_desc,
        )

    def _push(self, role: str, content: str):
        with self._lock:
            self.history.append({"role": role, "content": content})
            while len(self.history) > self.max_hist:
                self.history.pop(0)

    def _call_model(self, event_text: str) -> dict | None:
        url, key, model = mc_model_cfg()
        if not key:
            self.on_chat("*sparks* No API key set for Minecraft brain! Add it in MC Settings → Brain tab.")
            return None
        # Fallback: if brain_model is blank or looks wrong, use the main online model
        if not model:
            fallback = CONFIG.get("online_api_model", "")
            print(f"[MC_BRAIN] brain_model '{model}' → falling back to '{fallback}'")
            model = fallback
        self._push("user", event_text)
        msgs = [{"role": "system", "content": self._sys()}] + list(self.history)
        try:
            headers = {"Content-Type": "application/json",
                       "Authorization": f"Bearer {key}"}
            r = req.post(url, json={
                "model":       model,
                "messages":    msgs,
                "temperature": 0.85,
                "max_tokens":  80,
            }, headers=headers, timeout=15)
            r.raise_for_status()
            raw = r.json()["choices"][0]["message"]["content"].strip()
            self._push("assistant", raw)
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.S).strip()
            # Find first { ... } block in case model adds prose around the JSON
            m = re.search(r'\{.*\}', raw, re.S)
            if m:
                raw = m.group(0)
            return json.loads(raw)
        except req.exceptions.HTTPError as e:
            err_body = ""
            try: err_body = e.response.json().get("error", {}).get("message", str(e))
            except Exception: err_body = str(e)
            print(f"[MC_BRAIN] API HTTP error: {err_body}")
            self.on_chat(f"*sparks* Brain error: {err_body[:120]}")
            return None
        except Exception as e:
            print(f"[MC_BRAIN] API error: {e}")
            self.on_chat(f"*confused* Brain hiccup: {str(e)[:100]}")
            return None

    def _act_ai(self, decision: dict):
        if not decision: return
        emo  = decision.get("emotion", "neutral")
        chat = decision.get("chat")
        if emo:  self.on_emotion(emo)
        if chat:
            self.on_chat(chat)
            self.on_cmd("chat", {"message": chat})

    # ── LOCAL: display text+emotion instantly, no API ─────────────────────────
    def _local(self, key: str, text: str = None, emo: str = "neutral"):
        msg = text or _pick(key)
        self.on_emotion(emo)
        self.on_chat(msg)

    # ── Event router ──────────────────────────────────────────────────────────
    def handle_event(self, msg: dict):
        mtype = msg.get("type")

        # ── Only # prefixed in-game chat calls AI ────────────────────────────
        if mtype == "chat":
            user = msg.get("username", "?")
            text = msg.get("message", "")
            if not text.startswith("#"):
                return   # ignore all other in-game chat
            if not ai_feature("ai_hash_chat", True):
                return   # AI for #chat is disabled
            query = text[1:].strip()
            print(f"[MC_BRAIN] #CHAT from {user}: {query}")
            decision = self._call_model(f'[CHAT] {user}: "{query}"')
            self._act_ai(decision)

        # ── Observations — ALL LOCAL, instant ────────────────────────────────
        elif mtype == "observation":
            text    = msg.get("text", "")
            emotion = msg.get("emotion", "neutral")
            obs_key = msg.get("obs_key", "")
            print(f"[MC_BRAIN] Observation ({emotion}): {text}")
            self.on_emotion(emotion)
            self.on_chat(text)

        # ── Tasks — LOCAL ────────────────────────────────────────────────────
        elif mtype == "task_start":
            task = msg.get("task", "")
            task_list = msg.get("task_list", [task])
            print(f"[MC_BRAIN] Task started: {task}")
            label = " | ".join(task_list) if task_list else task
            self.on_task(label, True)
            # Silence task_start chat for informational-only tasks
            _SILENT_TASKS = {"inv", "inventory", "status", "Status", "Inventory"}
            if task not in _SILENT_TASKS:
                self.on_chat(f"*starts* {task}~")
                self.on_emotion("thinking")

        elif mtype == "task_queued":
            task = msg.get("task", "")
            qlen = msg.get("queue_length", 1)
            task_list = msg.get("task_list", [])
            print(f"[MC_BRAIN] Task queued: {task} ({qlen} in queue)")
            # Skip "On it!" entirely for silent informational tasks
            _SILENT_TASKS = {"inv", "inventory", "status", "Status", "Inventory"}
            if qlen == 1 and task not in _SILENT_TASKS:
                self.on_chat(f"On it! → {task}")
            label = " | ".join(task_list) if task_list else task
            self.on_task(label, True)

        elif mtype == "task_progress":
            done  = msg.get("done", 0)
            total = msg.get("total", 1)
            note  = msg.get("message", f"{done}/{total}")
            print(f"[MC_BRAIN] Progress: {note}")
            self.on_chat(f"*working* {note}")
            self.on_task(note, True)
            # thinking while working, happy only at the very end
            pct = done / max(total, 1)
            self.on_emotion("thinking" if pct < 0.8 else "happy")

        elif mtype == "task_result":
            # ── UNBLOCK THE QUEUE ──
            if self.task_queue:
                self.task_queue.on_task_result(msg)
                
            task   = msg.get("task")
            status = msg.get("status")
            note   = msg.get("message", "")
            task_list = msg.get("task_list", [])
            if status == "done":
                print(f"[MC_BRAIN] Task done: {task} — {note}")
                if ai_feature("ai_task_done"):
                    d = self._call_model(f"[TASK_DONE] {note}")
                    self._act_ai(d)
                else:
                    import random as _rand
                    # inv and status: data already came via dedicated signals — stay silent
                    if task in ("inv", "status", "inventory"):
                        pass   # no chat, no emotion — UI already updated via sig_inv/sig_status
                    elif note:
                        done_emos = ["happy", "excited", "neutral", "happy", "thinking"]
                        done_pool = [
                            f"*dusts hands* Done! {note}",
                            f"*fist pump* {note}",
                            f"Finished~ {note}",
                            f"*stretches* All done! {note}",
                            f"Done! {note}",
                        ]
                        self.on_emotion(_rand.choice(done_emos))
                        self.on_chat(_rand.choice(done_pool))
                # Update task bar with remaining tasks
                if task_list:
                    self.on_task(" | ".join(task_list), True)
                else:
                    self.on_task("", False)
            elif status == "error":
                print(f"[MC_BRAIN] Task error: {task} — {note}")
                # Show the ACTUAL error message, not a pool response
                self.on_emotion("confused")
                self.on_chat(f"*frowns* {note}" if note else "*sighs* Something went wrong~")
                self.on_task("", False)
            elif status == "cleared":
                self.on_chat("*stops* Queue cleared~")
                self.on_emotion("neutral")
                self.on_task("", False)

        elif mtype == "mode_changed":
            mode = msg.get("mode", "follower")
            note = msg.get("message", f"Mode: {mode}")
            print(f"[MC_BRAIN] Mode → {mode}")
            self.on_emotion("neutral" if mode == "follower" else "thinking")
            self.on_chat(note)

        elif mtype == "mode_info":
            self.on_chat(f"Current mode: {msg.get('mode','?')}")

        # ── Achievements — LOCAL or AI based on toggle ────────────────────────
        elif mtype == "advancement":
            title = msg.get("title", "an advancement")
            desc  = msg.get("description", "")
            print(f"[MC_BRAIN] Advancement: {title}")
            if ai_feature("ai_advancements"):
                d = self._call_model(f'[ADVANCEMENT] {msg.get("username","?")} got: {title} — {desc}')
                self._act_ai(d)
            else:
                self._local("advancement",
                             text=f'*gasps* "{title}"!! {_pick("advancement")}',
                             emo="excited")

        # ── Gift — LOCAL ──────────────────────────────────────────────────────
        elif mtype == "gift":
            item = msg.get("item", "something")
            print(f"[MC_BRAIN] Gift received: {item}")
            self._local("gift_received",
                         text=f'*picks up {item}* {_pick("gift_received")}',
                         emo="love")

        # ── Significant events — LOCAL or AI toggle ───────────────────────────
        elif mtype == "event":
            event  = msg.get("event", "")
            detail = msg.get("message") or msg.get("username") or msg.get("reason") or ""
            print(f"[MC_BRAIN] [EVENT] {event}: {detail}")
            if event == "died":
                self._local("death", emo="sad")
                # Queue a message about going to get items
                import random as _rand
                lines = [
                    "*respawning* Going to grab my stuff!",
                    "I died — going back for my items~",
                    "*ghost noises* On my way back for my stuff~",
                    "Ugh, I died... going to retrieve my items!",
                ]
                self.on_chat(_rand.choice(lines))
            elif event == "player_joined":
                self._local("player_joined", emo="happy")
            elif event == "friend_added":
                pass  # silent — bot.js already replied in-game
            elif ai_feature("ai_events") and event in {"kicked","disconnected"}:
                d = self._call_model(f"[EVENT] {event}: {detail}")
                self._act_ai(d)

        elif mtype == "emotion_hint":
            emotion = msg.get("emotion", "neutral")
            self.on_emotion(emotion)

        elif mtype == "stats":
            if msg.get("health", 20) <= 4:
                self.on_emotion("shocked")

        elif mtype == "radar":
            # Route radar payload to UI — on_radar callback set by main.py bridge
            entities = msg.get("entities", [])
            if hasattr(self, "on_radar") and self.on_radar:
                self.on_radar(entities)

        # ── Silent inventory update — bypasses chat/TTS entirely ─────────────
        elif mtype == "inventory_update":
            items = msg.get("items", [])
            print(f"[MC_BRAIN] Inventory update: {len(items)} item types")
            self.on_inv(items)   # routed directly to UI inventory tab

        # ── Silent status update — bypasses chat/TTS entirely ────────────────
        elif mtype == "status_update":
            hp   = msg.get("hp", "?")
            food = msg.get("food", "?")
            print(f"[MC_BRAIN] Status: HP={hp} Food={food}")
            self.on_status(msg)  # routed directly to UI stats label

        elif mtype == "whisper":
            user = msg.get("username", "?")
            text = msg.get("message", "")
            # Whispers always go to AI
            d = self._call_model(f'[WHISPER from {user}]: "{text}"')
            self._act_ai(d)

        elif mtype == "error":
            level   = msg.get("level", "warning")
            message = msg.get("message", "Unknown bot error")
            print(f"[BOT ERROR] {message}")
            txt = message
            if "ETIMEDOUT"    in message: txt = "*squints* Server timed out~ Is it running? ⏳"
            elif "ECONNREFUSED" in message: txt = "*taps screen* Connection refused! Is the server on? 🔌"
            elif "getaddrinfo" in message:  txt = "*confused* Can't find that server~ Check the IP! 🌐"
            elif "ECONNRESET"  in message:  txt = "*sighs* Connection was reset by the server~"
            elif "version"     in message.lower(): txt = "*sparks* Version mismatch! Check MC Version in settings~ ⚡"
            self.on_emotion("shocked" if level == "fatal" else "confused")
            self.on_chat(txt)

    def handle_player_input(self, text: str):
        if text.startswith('%'):
            self.send_cmd("text", {"text": text})
            return
        event_text = f'[PLAYER_INPUT] {self.sd.get("user_name","User")}: "{text}"'
        print(f"[MC_BRAIN] {event_text}")
        decision = self._call_model(event_text)
        self._act_ai(decision)

    # ── WebSocket listener ────────────────────────────────────────────────────
    async def _listen(self, ws_url: str):
        self.running = True
        try:
            async with websockets.connect(
                ws_url, open_timeout=10, close_timeout=5,
                ping_interval=20, ping_timeout=10,
            ) as ws:
                self.ws = ws
                print(f"[MC_BRAIN] Connected to bot WS at {ws_url}")
                async for raw in ws:
                    if not self.running: break
                    try:
                        msg = json.loads(raw)
                        self.handle_event(msg)
                    except json.JSONDecodeError as e:
                        print(f"[MC_BRAIN] Invalid JSON: {e}")
                    except Exception as e:
                        print(f"[MC_BRAIN] Event handler error: {e}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[MC_BRAIN] WS disconnected: {e}")
        finally:
            self.running = False
            self.ws      = None
            # Unblock any zombie task worker waiting on result_event
            if self.task_queue is not None:
                try:
                    self.task_queue.abort_all("ws_disconnected")
                except Exception as te:
                    print(f"[MC_BRAIN] task_queue abort error: {te}")

    def start_listening(self, ws_url: str = "ws://localhost:8765"):
        if self._loop and not self._loop.is_closed(): return
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        def _run():
            try:
                self._loop.run_until_complete(self._listen(ws_url))
            except RuntimeError:
                pass
            finally:
                try:
                    pending = asyncio.all_tasks(self._loop)
                    for t in pending: t.cancel()
                    if pending: self._loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
                except Exception: pass
                finally: self._loop.close()
        threading.Thread(target=_run, daemon=True, name="mc_brain_ws").start()

    def stop(self):
        self.running = False
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._loop.stop)

    def send_cmd(self, cmd: str, args: dict = {}):
        if not self.ws or not self.running:
            print("[MC_BRAIN] Not connected to bot WS")
            return
        payload = json.dumps({"cmd": "text", "text": args.get("text", "")} if cmd == "text"
                             else {"cmd": cmd, "args": args})
                             
        asyncio.run_coroutine_threadsafe(self.ws.send(payload), self._loop)