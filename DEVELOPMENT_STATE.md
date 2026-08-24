# ProjectDVC 2.0 — Development State

> **Catch-up file for any AI session.** Read this top-to-bottom and you know
> exactly where the project stands. Last updated: 2026-08-24.

---

## 1. What this project is

**ProjectDVC** — a desktop virtual AI companion (anime-style character that
lives on your desktop, chats with you, changes emotion sprites, remembers you,
and speaks with TTS). Originally built in Python/PyQt6 by Abtin; **now being
rebuilt as an Electron + React app.** Minecraft drone integration is planned
but deferred (the old Mineflayer bot is kept, untouched, in `drone/`).

- Author/owner: **Abtin** (github.com/OneEyeAbtin). All feature decisions are his.
- Working style: Abtin **vibe codes** — he describes, AI implements. Keep
  generated code in plain JavaScript (no TypeScript). React chosen because AI
  models generate it most reliably.

## 2. Where we are in the rebuild

**Plans 1 and 3 are COMPLETE and reviewed.** Branch:
`electron-rebuild` (30+ commits ahead of `main`). Main still holds the
pre-rebuild checkpoint commit `e812075`.

| Phase | Status | Contents |
|---|---|---|
| Plan 1 ✅ | **done, on branch** | Scaffold, themes, config+migration, memory, characters, brain, IPC, wizard, companion UI, context menu, settings shell |
| Plan 2 ⬜ | **next** | Voice: TTS chain (ElevenLabs→edge-tts→Piper), lip-sync, mic STT (Groq first) |
| Plan 3 ✅ | **done, on branch** | Depth+QoL: stats dialog, memory viewer + wipes + msg-limit, history channels, regenerate, tray/window persistence/always-on-top, WebAudio sounds, regenerate/copy buttons, shortcuts, font scale, redo-setup + factory reset. Commit range: `32017e0..3f7d315` |
| Audit ✅ | **done, on branch** | Deep logic audit (1 Critical/3 Important/8 Minor — all fixed) + QoL wave. Commit range: `60df194..0a1454b`. 148/148 tests |
| Polish C ✅ | **done, on branch** | Session-summary boot greeting, idle chatter (toggle `idle_chat`), memory export/import, bubble text select, shared emotions module, defensive patches. Commit range: `0a1454b..3e41d58`. 170/170 tests |
| Plan 4 ⬜ | after Plan 2 | Minecraft reattach via `minecraft_v2` slot (drone/ untouched, waiting) |

**Spec:** `docs/superpowers/specs/2026-08-23-electron-rebuild-design.md`
**Plan 1:** `docs/superpowers/plans/2026-08-23-plan1-scaffold-core-companion.md`
**Plan 3:** `docs/superpowers/plans/2026-08-24-plan3-depth-qol.md`
**Audit + fix waves:** `.superpowers/sdd/2026-08-24-plan3-depth-qol/audit-report.md` (findings) — all 26 items fixed & re-reviewed MERGE_READY
**Execution ledger (all review findings + rulings):**
`.superpowers/sdd/2026-08-23-plan1-scaffold-core-companion/progress.md`

### Plan 3 rulings & known minors (summary)

Rulings made during implementation:

1. Tray/polish items were pulled forward from phase 5 into Plan 3 (controller ruling).
2. ElevenLabs voice settings UI stayed deferred to Plan 2 with the rest of voice.
3. New persisted keys — SAVE_KEYS += `win_x`, `win_y` (-1 = unset), `font_scale`;
   SETTINGS_KEYS += `always_on_top`, `tray_enabled`, `ui_sounds`, `hide_to_tray`.
4. Window position restored via pure `clampToWorkarea()` (unit-tested); tray
   creation wrapped in try/catch for Linux AppIndicator failures.
5. Factory reset deletes data files but re-instantiates config/memory/brain
   services IN PLACE and rewrites the `.migrated` marker WITHOUT re-running
   migration (prevents legacy `dvc_profile.json` key resurrection after reset).
6. Destructive memory/reset buttons all use two-step "Really?" confirmation.
7. Cheat codes now always push a `reply` (with the cheat's display line) so the
   renderer's thinking state clears via the normal typewriter flow; the
   `{cheated:true}` ack is unchanged. `force*`/`showmehearts` got short new
   display lines (`*strikes a pose*` / hearts toggle lines) — they were silent in
   legacy; Abtin may want to reword.
8. Preload allowlists are exported from `src/preload/api.js` so tests assert
   allowlist ↔ ipcMain handler parity in BOTH directions.

Known minors introduced by Plan 3 (non-blocking):

- `cheat:try` also triggers the reply push (channel currently unused by renderer).
- After `amnesia` the MEM counter shows 1 (reply push increments after reset).
- Tray icon is a generated magenta placeholder; no dedicated app icon yet.

## 3. How to run / test

```bash
npm install        # once
npm run dev        # dev launch (Linux: see sandbox note below)
npm test           # vitest, 170 tests, all green
npx electron-vite build   # prod build to out/
```

**Linux dev note:** Chromium SUID sandbox isn't configured on Abtin's machine.
Launch dev with `ELECTRON_DISABLE_SANDBOX=1 npm run dev` (or fix properly with
`sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755
node_modules/electron/dist/chrome-sandbox`). Windows doesn't need this.

## 4. Architecture (what exists now)

```
src/main/            Electron main = the brain (plain Node, no Python anywhere)
  index.js             window (400x700 frameless transparent always-on-top) + service boot
  bus.js               EventEmitter event bus (topics: emotion:set, stats:changed, …)
  ipc.js               ALL ipcMain handlers + cheat codes + push forwarding
  services/
    config.service.js    data/config.json + data/save.json, legacy migration
    memory.service.js    3-tier memory, dedup(≥0.75 sim, keep-longer), cap 30
    characters.service.js scans assets/outfits/, prefix detection, sprite resolve
    window.service.js    tray (hide-to-tray), position persist/restore+clamp,
                         always-on-top — applied live from profile:save
    brain.service.js     LLM calls, [EMOTION:]/[TRAIT:]/[STAT:] tag parsing,
                         offline fallback mode, session-summary compression
  data/ (in src/main/data/)
    defaults.js          ported _DEFAULTS + SETTINGS_KEYS/SAVE_KEYS
    personas.js          24 personas, greetings, DEAD_MSGS, DEEP_MAP, EMO_REMAP,
                         OFFLINE_FALLBACKS, GREETING_TEMPLATES
    themes.js            THEME_LIST (12 ids) + THEMES_NAME_TO_ID
  providers/llm.js       OpenAI-compatible fetch caller
src/preload/api.js   window.dvc bridge — channel ALLOWLIST (security)
src/renderer/        React (zustand store, features/{setup,companion,menu,settings,stats})
  lib/sfx.js           WebAudio synth sounds (blip/notify/statUp/statDown/error)
  styles/themes.css    12 themes as [data-theme] CSS variable blocks
legacy/              entire old Python app (reference only, never delete)
drone/               old Mineflayer bot — UNTOUCHED, waits for Plan 4
assets/outfits/      character sprites [Prefix][Emotion].png — untouched
```

**IPC contract** (preload allowlist, enforced + parity-tested):
invoke: `app:init, setup:complete, msg:send, msg:regenerate, profile:save,
profile:factory-reset, setup:redo, stats:adjust, memory:delete-trait,
memory:wipe-traits, memory:delete-permanent, memory:wipe-permanent,
memory:clear-summary, history:get, history:clear, outfit:switch, cheat:try,
voice:speak, voice:stop` · push: `reply, emotion, stats, traits, memory,
error, tts, profile`

## 5. Data migration (already works against real data)

On first boot: `dvc_profile.json` → split into `data/config.json` +
`data/save.json` (theme display name → kebab `theme_id`); `traits.txt` →
`data/memory/session-traits.json`; `data/permanent_facts.json` →
`data/memory/permanent-facts.json`. Marker: `data/memory/.migrated`. Idempotent.
Legacy files never touched. Verified with Abtin's real profile (Goth Baddie /
Darkwave / 21 traits).

**`dvc_profile.json` and `traits.txt` are deliberately UNTRACKED (contain API
keys). `data/config.json`, `data/save.json`, `data/memory/` also gitignored.**

## 6. Decisions & rulings (do not silently reverse)

1. 24 personas (README said 23 — miscount; "Overly Dramatic Vampire" restored).
2. Only 9 palettes existed in legacy; **Neon City / Amber Terminal / Gold were
   authored new** — Abtin should review colors in `themes.css`.
3. Dedup keeps the LONGER string (legacy difflib semantics).
4. `talking`/`fullbody` emotions are transient — never persisted to save.
5. Personas live in `personas.js`, NOT in DEFAULTS (consumers import directly).
6. `default_persona` fallback chain: persona → 'Gothic' → ''.
7. Sprite serving: dev = vite `/@fs/`, prod = build-copied `out/renderer/sprites/`
   (spec originally said custom `dvc-file://` protocol — deviation, safe).
8. ~~Voice/Memory settings tabs are placeholders until Plans 2/3.~~ Memory tab is REAL as of Plan 3; only Voice remains a placeholder until Plan 2.
9. (Plan 3) Message-limit slider bounds are 4..50 — legacy allowed 5..200. Ruled acceptable: >50 history bloats prompts; migrated values >50 stay in config but slider shows clamped. Widen only if Abtin asks.
10. (Plan 3) Stat up/down sounds now fire on ANY stats change (cheats, [STAT:] tags), not just dialog clicks — legacy only played them in the dialog. Deemed desirable.
11. (Plan 3) force*/showmehearts cheats got invented display lines ("*strikes a pose*", hearts-toggle line) — legacy showed nothing there. Abtin may reword in src/main/ipc.js displayCheatMessage.

## 7. Known deferred minors (full list in ledger)

- `patch*` config methods return live refs (getters are safe copies)
- Nested legacy `tts` settings object dropped in migration (flat keys kept — revisit Plan 2)
- `TRANSIENT_EMOTIONS` duplicated in 3 files
- No ARIA menu role semantics / no modal focus trap in settings
- `copySprites` doesn't prune stale files; wizard setTimeout not cleared on unmount
- MEM counter counts replies not turns
- Interact menu items go through full LLM round-trip (legacy did too via AI)

## 8. What Abtin should check in the running app (visual QA)

1. `npm run dev` → window appears: 400×700, rounded, glassy, always-on-top
2. **Drag** the window by top bar; min/close dots work (close = **hides to tray** by default — quit via tray icon menu, or toggle "Tray icon"/"Hide to tray" off in Settings → General to make close quit)
3. If migrated: companion page directly, correct pet name + Darkwave theme
4. If fresh: 20-question wizard → greeting with persona-specific line
5. Type a message (offline mode works keyless) → *thinking…* → typewriter
   bubble → **sprite changes** to the tagged emotion
6. Right-click → outfits / personas / themes / interact menus all function;
   theme switch is instant
7. Gear icon → settings overlay; change names/brain mode/API keys → Save → restart persists
8. Cheat codes: `rosebud` (max affection, hearts pulse), `forcehappy`, `iddqd`
9. Restart → persona/outfit/theme/emotion all restored
10. Sprites: no green fringes (greenscreen keyed), fallback doodle if missing

## 9. Immediate next steps

1. Abtin runs visual QA (§8) on his machine, reports issues
2. Write Plan 2 (voice: TTS chain, lip-sync, mic STT) → execute same subagent-driven flow
3. Then Plan 4 (Minecraft reattach via `minecraft_v2` slot in drone/)
4. Merge `electron-rebuild` → `main` when Plans 2–4 are done and Abtin is happy
