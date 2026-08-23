# ProjectDVC 2.0 — Electron Rebuild Design Spec

**Date:** 2026-08-23
**Author:** Abtin (design), rebuilt from ProjectDVC 1.x (Python/PyQt6)
**Status:** Approved

---

## 1. Goal

Rebuild ProjectDVC — the desktop virtual companion ("Desktop VC") — as an
Electron + React application, replacing the Python/PyQt6 cortex entirely.
The Minecraft drone is **out of scope for v1** but the architecture reserves a
documented integration slot so it can be reattached later without refactoring.

## 2. Decisions (approved)

| Decision | Choice | Rationale |
|---|---|---|
| Framework | **Electron** | User's Mineflayer drone is already Node; biggest ecosystem; vibe-code friendly |
| Frontend | **React + Vite, plain JavaScript** | Most AI-training-data of any UI stack → best first-shot generated code |
| Brain location | **Electron main process** | One process model; clean service boundaries; MC drone later plugs into same bus |
| Minecraft | **Excluded from v1**, `drone/` kept untouched + `minecraft.js` stub service | Rebuild desktop companion first |
| Visual direction | Dark glassmorphism over existing 12 themes; Fredoka + Nunito Sans; Lucide SVG icons | ui-ux-pro-max design system query results |
| Language | JavaScript (no TypeScript) | Reduce build friction for vibe coding |

## 3. Architecture

```
┌──────────────────────────── Electron app ────────────────────────────┐
│                                                                      │
│  MAIN PROCESS (the brain)                 RENDERER (the face)        │
│  ┌──────────────────────────┐            ┌───────────────────────┐   │
│  │ index.js  lifecycle      │   ipc.js   │ React + Vite          │   │
│  │ bus.js    event bus ◄────┼───preload──┤ features/chat         │   │
│  │ services/                │  api.js    │ features/emotions     │   │
│  │   config.js              │            │ features/setup        │   │
│  │   memory.js              │            │ features/settings     │   │
│  │   brain.js               │            │ features/voice        │   │
│  │   persona.js             │            │ styles/themes.css     │   │
│  │   voice.js               │            └───────────────────────┘   │
│  │   characters.js          │                                        │
│  │   minecraft.js (STUB)    │       providers/: llm/, tts/, stt/     │
│  └──────────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 Event bus (`bus.js`)

Tiny EventEmitter wrapper. Services communicate by emitting/subscribing to
named topics instead of importing each other. Topics are namespaced:

- `msg:*` — user message lifecycle (`msg:send`, `reply:start`, `reply:done`)
- `emotion:set` — canonical emotion changes
- `stats:changed`, `traits:changed`, `memory:changed`
- `tts:*` — synthesis request/result
- `profile:changed` — any persisted mutation
- `mc:*` — RESERVED for future Minecraft integration

### 3.2 IPC contract (`ipc.js` + `preload/api.js`)

The ONLY doorway between renderer and main. contextBridge exposes
`window.dvc` with two shapes:

```js
// Request/response
dvc.invoke(channel, payload) -> Promise<result>

// Push events
dvc.on(channel, callback) -> unsubscribe function
```

Channels (v1):

| Direction | Channel | Payload → Result |
|---|---|---|
| UI→main | `app:init` | `{}` → full boot state {profile, save, traits, outfits manifest, themes} |
| UI→main | `setup:complete` | answers map → updated profile |
| UI→main | `msg:send` | `{text}` → ack; reply arrives via push |
| UI→main | `profile:save` | partial patch → saved profile |
| UI→main | `outfit:switch` | `{name}` |
| UI→main | `cheat:try` | `{text}` → handled bool |
| UI→main | `voice:speak` | `{text, emotion}` → tts file path via push |
| UI→main | `voice:stop` | `{}` |
| main→UI | `reply` | `{text, emotion, stats?, traits?}` (tags already stripped) |
| main→UI | `emotion` | `{name}` |
| main→UI | `tts` | `{path} \| {stopped:true}` |
| main→UI | `stats` / `traits` / `memory` | changed slices |
| main→UI | `error` | `{scope, message}` |

Security: `contextIsolation: true`, `nodeIntegration: false`, no remote module.
Asset files served to renderer via custom privileged protocol `dvc-file://`.

### 3.3 Services

Each service = one file in `src/main/services/`, one responsibility,
communicates via bus, persists through config/memory layers.

#### config.service
- Loads/saves `data/profile.json` (settings + API endpoints + persona choice +
  theme + setup answers).
- Ships `_defaults` mirroring old `_DEFAULTS` (minus MC block — kept under a
  `minecraft_v2` key reserved for later).
- One-time migration: if legacy `dvc_profile.json` exists at repo root, split
  it → `config.json` (settings) + `save.json` (user state); move
  `permanent_facts.json` → `data/memory/permanent-facts.json`;
  `traits.txt` → `data/memory/session-traits.json`. Legacy files preserved.

#### memory.service (3 tiers, ported behavior)
1. **Permanent facts** — `data/memory/permanent-facts.json`, never expires.
2. **Session traits** — `data/memory/session-traits.json`, capped at 30,
   deduplicated at ≥0.82 similarity (string-similarity lib replacing difflib),
   compressed to dense sentences at ≥25 entries via LLM call.
3. **Session summary** — raw last-20 history cached on close
   (`data/memory/session-cache.json`), lazily compressed on first message of
   next session; raw restored on failure.
- `classifyTrait(trait)` ports keyword heuristics (permanent vs session).
- `buildMemoryPrompt()` assembles PROFILE / LEARNED / LAST SESSION blocks.

#### brain.service
- `send(text)` → builds system prompt (persona + stats + memory + strict
  rules incl. `[EMOTION:]` `[TRAIT:]` `[STAT:]` tag contract) → calls LLM via
  provider → parses tags → emits `emotion`, `stats`, `traits`, then `reply`.
- Modes: `online` (any OpenAI-compatible cloud), `local` (LM Studio/Ollama),
  `offline` (rule-based fallback pool, zero network).
- Tag regexes identical to v1: `/\[STAT:\s*(\w+)\s*([+-]\d+)\]/i`,
  `/\[TRAIT:\s*(.+?)\]/i`, `/\[EMOTION:\s*(\w+)\]/i`; emotion remap table
  (`surprised→shocked` etc.) and deep-scan keyword fallback ported.
- History window: configurable max (default 20).

#### persona.service
- Static data: all 23 personas, greetings per persona, dead-brain messages,
  interaction definitions, cheat codes, offline fallback pool.
- Ported verbatim from `core/config.py` / `core/constants.py` into JS data
  modules under `src/main/data/`.

#### voice.service
- TTS arbitration identical priority: ElevenLabs (if configured & selected)
  → edge-tts (online) → Piper (offline). ElevenLabs quota/auth errors
  (`EL_QUOTA:` class) fall back down-chain silently.
- Output WAV/MP3 written to `data/tts-cache/`; path pushed to renderer;
  renderer plays via `<audio>`.
- STT (phase 4): renderer getUserMedia/MediaRecorder → webm blob →
  `stt:transcribe` → Groq Whisper multipart from main. Local whisper deferred.

#### characters.service
- Scans `assets/outfits/*.png` at boot → manifest:
  `{ outfits: [{name, prefix, emotions[], hasFullbody}], defaultOutfit }`.
- Prefix auto-detection identical rule: filename stem ends with known emotion
  name → prefix is the remainder.
- Green-screen (`#00FF00`) removal happens in the renderer: a memoized
  `SpriteImage` component keys each sprite exactly once per (outfit, emotion)
  via canvas (numpy-fast-path equivalent not needed — sprites are small
  pixel art), caches the result URL in a module-level Map.
  No native image dependencies (no sharp/jimp) required.

#### minecraft.service (STUB)
- Exports nothing functional. Contains documented contract: how bot.js will
  spawn as child process, which `mc:*` bus topics it will emit
  (`mc:event`, `mc:task_result`, `mc:radar`), and which IPC channels will be
  added (`mc:cmd`). Exists so future integration needs no refactor.

## 4. Renderer design

### 4.1 Window
400×700, frameless, transparent, always-on-top, draggable via title region.
Rounded corners native (transparent window). Min/close as custom buttons.

### 4.2 State management
Zustand store, single source of truth:

```js
{
  booted, setupComplete,
  petName, userName, persona, outfit,
  emotion,            // canonical; 'talking' is transient render state
  bubbleText, typing, thinking,
  stats: {...10 stats}, heartsVisible,
  traits: [], permanentFacts: [],
  outfits: [...manifest], theme: 'midnight-sakura',
  historyCount, maxHistory,
}
```

### 4.3 Emotion/lip-sync state machine (React)
`thinking` → `neutral` → typewriter (per-word `talking` toggle if text lip-sync
on) → target emotion. When TTS audio plays and TTS lip-sync enabled: sprite
alternates current-emotion ↔ `talking` every 150ms until `<audio>` `ended`,
then lands on target emotion. `talking` never becomes the persisted emotion.

### 4.4 Screens
- Setup wizard page (20 questions, progress bar) ↔ main companion page
  (QStackedWidget equivalent = conditional render).
- Main: top bar (hearts · name · settings dots) / portrait area with emotion +
  outfit badges / chat panel with input row (send, mic placeholder, replay).
- Settings dialog: tabbed (General / Memory / AI-API / Voice) — non-blocking
  overlay inside the window.
- Right-click context menu: outfits, personas (grouped), interact actions,
  settings entries, theme picker.

### 4.5 Themes
`themes.css`: each theme = `[data-theme='x']{ --bg1..--accent.. }` block
porting the 12 palettes. Switching = `document.documentElement.dataset.theme`.
Glassmorphism utilities consume variables: frosted panels
(`backdrop-filter: blur(15px)`), hairline borders, layered depth.

### 4.6 Typography & icons
Fredoka (headings/badges/personality) + Nunito Sans (body). Lucide React icons
for all controls — no emoji-as-icon in chrome (emoji stay welcome *inside*
companion speech).

### 4.7 Motion
Spring-ish CSS transitions for emotion swaps (180ms), heart pulse on affection
delta, typewriter caret blink. All non-essential animation wrapped in
`prefers-reduced-motion` guard.

## 5. Data migration

One-time, idempotent, runs at boot when legacy artifacts detected:

```
dvc_profile.json  → data/config.json + data/save.json (+ data/tts keys)
traits.txt        → data/memory/session-traits.json
data/permanent_facts.json → data/memory/permanent-facts.json
assets/outfits/*  → assets/outfits-keyed/*  (degreened, cached by mtime)
```

Legacy files remain untouched at root for reference/rollback.

## 6. Error handling

- LLM failures: offline-mode style dead-brain messages for local; explicit
  key/URL error bubble for online (ported copy). Never crash the window.
- Missing sprites: procedural fallback character (canvas-drawn, ported logic).
- TTS chain exhaustion: silent fail + console log (matches v1).
- All services wrap I/O in try/catch and emit `error` bus topics.

## 7. Testing

- **vitest** unit tests (main process, no Electron needed):
  - tag parsing (STAT/TRAIT/EMOTION extraction + remap + deep scan)
  - memory dedup/classify/rotate/compress-threshold
  - config defaults + migration splitting
  - persona data integrity (all personas have descriptions; greetings exist)
- Renderer verified manually per phase checklist (window drags, theme swaps,
  wizard completes, chat round-trip, emotion swap visible).

## 8. Build phases

1. **Scaffold** — restructure repo (legacy/), Electron+React+Vite shell,
   frameless themed window, config service + migration. *Runnable shell.*
2. **Core companion** — brain service + chat loop + emotions + sprites +
   setup wizard. *Talking companion.*
3. **Depth** — memory tiers live-wired, stats/hearts, personas menu,
   interactions, cheats, full settings dialog.
4. **Voice** — TTS engines + lip-sync + replay; mic STT (Groq first).
5. **Polish** — tray, packaging (electron-builder), README rewrite,
   minecraft stub finalized.

Phases 3–5 get their own implementation plans after Phase 2 ships working.

## 9. Non-goals (v1)

- No Minecraft integration (stub only)
- No radar/inventory/console tabs
- No multi-monitor positioning persistence beyond default center
- No auto-update pipeline
