"""
[MODULE] mc_tasks.py
[SYSTEM] ProjectDVC — Minecraft task sequencer. Translates high-level natural
         language commands into structured bot.js payloads. Maintains a
         thread-safe queue so tasks never overlap, with per-task timeouts
         and a zombie-unblock mechanism for clean WS disconnect recovery.
[AUTHOR] Abtin

Copyright (c) 2026 Abtin (github.com/OneEyeAbtin). All rights reserved.
This code may not be copied, modified, or distributed without permission.
"""
import threading, queue, time
from dataclasses import dataclass, field
from typing import Callable

# ── Task definitions ──────────────────────────────────────────────────────────
@dataclass
class Task:
    name:    str
    cmd:     str
    args:    dict = field(default_factory=dict)
    label:   str  = ""   # human-readable description shown in UI

# ── Built-in task builders ────────────────────────────────────────────────────
def task_follow(username: str) -> Task:
    return Task("follow", "follow", {"username": username},
                label=f"Following {username}")

def task_goto(x: int, y: int, z: int) -> Task:
    return Task("goto", "goto", {"x": x, "y": y, "z": z},
                label=f"Going to {x},{y},{z}")

def task_mine(block: str, count: int = 1) -> Task:
    return Task("mine", "mine", {"block": block, "count": count},
                label=f"Mining {count}x {block}")

def task_place(block: str, x: int, y: int, z: int) -> Task:
    return Task("place", "place", {"block": block, "x": x, "y": y, "z": z},
                label=f"Placing {block} at {x},{y},{z}")

def task_chat(message: str) -> Task:
    return Task("chat", "chat", {"message": message},
                label=f'Say: "{message}"')

def task_stop() -> Task:
    return Task("stop", "stop", {}, label="Stopping current task")

def task_status() -> Task:
    return Task("status", "status", {}, label="Checking status")

# ── Parser: natural language → Task ──────────────────────────────────────────
def parse_task(text: str, default_username: str = "User") -> Task | None:
    """
    Try to parse a plain-text command into a Task.
    Used when player types directly into the Minecraft Mode UI.
    Returns None if the text should be passed to the AI brain instead.
    """
    import re
    t = text.strip().lower()

    # follow [me|username]
    m = re.match(r"^follow\s*(.*)$", t)
    if m:
        target = m.group(1).strip() or default_username
        return task_follow(target)

    # come here / come to me
    if re.search(r"\bcome\s*(here|to me)\b", t):
        return task_follow(default_username)

    # stop / halt / cancel
    if re.match(r"^(stop|halt|cancel|nevermind)$", t):
        return task_stop()

    # go to X Y Z
    m = re.match(r"^(?:go\s*to|goto|tp\s*to)?\s*(-?\d+)[,\s]+(-?\d+)[,\s]+(-?\d+)$", t)
    if m:
        return task_goto(int(m.group(1)), int(m.group(2)), int(m.group(3)))

    # mine [N] block_name
    m = re.match(r"^mine\s+(\d+)?\s*(\w+)$", t)
    if m:
        count = int(m.group(1)) if m.group(1) else 1
        block = m.group(2)
        return task_mine(block, count)

    # get / collect N block_name
    m = re.match(r"^(?:get|collect|gather)\s+(\d+)?\s*(\w+)$", t)
    if m:
        count = int(m.group(1)) if m.group(1) else 1
        block = m.group(2)
        return task_mine(block, count)

    # place block X Y Z
    m = re.match(r"^place\s+(\w+)\s+(-?\d+)[,\s]+(-?\d+)[,\s]+(-?\d+)$", t)
    if m:
        return task_place(m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4)))

    # status / where are you / inventory
    if re.match(r"^(status|where are you|inventory|stats|pos|position)$", t):
        return task_status()

    # say "something" — force a chat message
    m = re.match(r'^say\s+"?(.+)"?$', t)
    if m:
        return task_chat(m.group(1))

    return None  # hand off to AI brain

# ── Task queue manager ────────────────────────────────────────────────────────
class TaskQueue:
    def __init__(self,
                 send_cmd:    Callable[[str, dict], None],
                 on_task_start: Callable[[Task], None] | None = None,
                 on_task_done:  Callable[[Task], None] | None = None):
        """
        send_cmd(cmd, args)   — sends a command to mc_brain → bot.js
        on_task_start(task)   — UI callback when a task begins
        on_task_done(task)    — UI callback when a task completes
        """
        self._q            = queue.Queue()
        self._send         = send_cmd
        self._on_start     = on_task_start or (lambda t: None)
        self._on_done      = on_task_done  or (lambda t: None)
        self._current      = None
        self._lock         = threading.Lock()
        self._result_event = threading.Event()
        self._last_result  = None
        self._running      = False

    def enqueue(self, task: Task):
        """Add a task to the queue."""
        print(f"[TASKS] Queued: {task.label}")
        self._q.put(task)
        if not self._running:
            self._start_worker()

    def clear(self):
        """Drop all pending tasks and stop the current one."""
        with self._lock:
            while not self._q.empty():
                try: self._q.get_nowait()
                except queue.Empty: break
        self._send("stop", {})
        print("[TASKS] Queue cleared")

    def abort_all(self, reason: str = "disconnected"):
        """
        Called when the WebSocket drops.
        Clears the queue AND force-sets the result event so the worker
        thread unblocks immediately instead of waiting out its timeout.
        """
        with self._lock:
            while not self._q.empty():
                try: self._q.get_nowait()
                except queue.Empty: break
        # Inject a fake 'error' result so the worker wakes up and exits cleanly
        self._last_result = {"status": "error", "message": f"WS {reason}"}
        self._result_event.set()
        self._running = False
        print(f"[TASKS] Aborted (zombie unblock): {reason}")

    def on_task_result(self, result: dict):
        """
        Called by mc_brain when a task_result event arrives from bot.js.
        Unblocks the worker thread.
        """
        self._last_result = result
        self._result_event.set()

    @property
    def current_label(self) -> str:
        return self._current.label if self._current else "Idle"

    # ── Worker ────────────────────────────────────────────────────────────────
    def _start_worker(self):
        self._running = True
        t = threading.Thread(target=self._worker, daemon=True, name="task_worker")
        t.start()

    def _worker(self):
        while True:
            try:
                task = self._q.get(timeout=1)
            except queue.Empty:
                self._running = False
                self._current = None
                break

            with self._lock:
                self._current = task

            self._on_start(task)
            print(f"[TASKS] Starting: {task.label}")

            # Send the command to the bot
            self._result_event.clear()
            self._send(task.cmd, task.args)

            # Wait for completion (with 60s timeout for long tasks like mining)
            _INFINITE = {"cave", "explore", "strip", "guard", "farm", "fish", "lumber", "tunnel"}
            timeout = 9999 if task.cmd in _INFINITE else (120 if task.cmd == "mine" else 60)
            completed = self._result_event.wait(timeout=timeout)

            if not completed:
                print(f"[TASKS] Timeout on: {task.label}")
            else:
                result = self._last_result or {}
                status = result.get("status", "?")
                print(f"[TASKS] Done ({status}): {task.label}")

            self._on_done(task)
            self._q.task_done()

        self._current = None
        self._running = False
