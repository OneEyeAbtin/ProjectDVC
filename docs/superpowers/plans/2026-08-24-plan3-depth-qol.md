# ProjectDVC 2.0 — Plan 3: Depth + Quality-of-Life

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the "Depth" spec phase — real stats dialog, full memory viewer, message-limit control — plus controller-selected QoL: tray with hide-to-tray, window position persistence, always-on-top toggle, WebAudio UI sounds, regenerate/copy reply, keyboard shortcuts, font scale, redo-setup and factory reset.

**Architecture:** Main-process gains a `window.service.js` (tray + position persistence) and IPC extensions for stats/memory/history operations. Renderer gains three feature components (StatsDialog, MemoryTab content, SFX engine) and General-tab additions. All state mutations flow through existing bus/IPC patterns.

**Tech Stack:** Existing stack only — Electron Tray/Menu/screen APIs, React, zustand, WebAudio API (no new deps).

**Spec:** `docs/superpowers/specs/2026-08-23-electron-rebuild-design.md` (§4.4 screens, §8 phase 3) + controller QoL rulings below.

## Global Constraints

- Plain JavaScript, no TypeScript, no new npm dependencies.
- Renderer stays sandboxed; all new capabilities go through the preload allowlist (extend it deliberately).
- All persisted keys land in `data/save.json` (SAVE_KEYS) or `data/config.json` (SETTINGS_KEYS) via existing patch methods; new keys MUST be added to the right list in `src/main/data/defaults.js`.
- Legacy behavior parity where ported: stats clamp 0..100; factory reset wipes data files but keeps legacy originals; redo-setup clears setup state and traits (legacy `_setting('redo_setup')`).
- Existing 84 tests must stay green after every task.
- Emotion rules from Plan 1 still apply (talking/fullbody transient).

## New persisted keys (ruling)

SAVE_KEYS += `win_x` (int, -1 = unset), `win_y` (int, -1), `font_scale` (1.0)
SETTINGS_KEYS += `always_on_top` (true), `tray_enabled` (true), `ui_sounds` (true), `hide_to_tray` (true)

---

### Task 1: IPC extensions + brain regenerate

**Files:**
- Modify: `src/main/ipc.js`, `src/preload/api.js` (allowlist), `src/main/data/defaults.js` (new keys), `src/main/services/brain.service.js` (add regenerate)
- Test: `tests/ipc-extensions.test.js`

**Interfaces produced (invoke channels):**
- `stats:adjust` `{key, delta}` → clamps 0..100, patches save, pushes `stats`, returns save.stats
- `memory:delete-trait` `{text}` → removes first matching session trait, persists, pushes `traits`, returns traits
- `memory:wipe-traits` `{}` → clears session traits only
- `memory:delete-permanent` `{text}` / `memory:wipe-permanent`
- `memory:clear-summary` `{}` → save.session_summary = ''
- `history:get` `{}` → `{history: brain.history}` (array of {role, content})
- `history:clear` `{}` → clears brain history, returns {}
- `msg:regenerate` `{}` → brain.regenerate(); reply flows via existing push; ack `{queued:true}` or `{error:'nothing to regenerate'}`
- `setup:redo` `{}` → save.setup_complete=false, setup_answers={}, clears session traits (legacy parity), returns save
- `profile:factory-reset` `{}` → deletes data/config.json + data/save.json + data/memory/* (session-traits, permanent-facts, session-cache, .migrated marker), re-instantiates config/memory services in place, returns fresh save (setup_complete=false). Legacy root files untouched.

**brain.service addition:** `regenerate()` — if last history item is assistant and there is a preceding user msg: pop the assistant entry, re-send the last user text through the normal send path (without re-pushing the user msg into history twice), return the reply object; else return null.

- [ ] Step 1: failing tests for each channel (use existing tests/ipc.test.js harness patterns — real services + tmpdir root). Cover: clamp behavior; delete-trait removes only first match; regenerate pops assistant and calls LLM again (stub callLLM counting calls); factory reset recreates defaults and removes files; setup:redo parity with legacy.
- [ ] Step 2: implement until green; extend preload allowlist with the new invoke channels exactly.
- [ ] Step 3: `npm test` + `npx electron-vite build`; commit "feat: IPC extensions for stats, memory, history, regenerate, reset".

---

### Task 2: Window service — tray, position, always-on-top

**Files:**
- Create: `src/main/services/window.service.js`
- Modify: `src/main/index.js` (use service), `src/main/ipc.js` (profile:save side-effects for always_on_top), `src/main/data/defaults.js` (keys from Global Constraints)

**window.service.js contract:** `createWindowService({ win, config, defaults })` →
- `applySettings()` — reads config: always_on_top → `win.setAlwaysOnTop(bool)`; tray_enabled → create/destroy Tray (icon: native 16px template — use `nativeImage.createFromPath` on a new `assets/icon.png` 32×32 PNG generated at boot via nativeImage from dataURL if missing; simple magenta rounded square with 'D').
- `trackPosition()` — debounced (500ms) save of win bounds → patchConfig({win_x, win_y}) — ONLY after `config.migrateLegacyIfNeeded()` has run (boot order guarantee in index.js).
- `restorePosition()` — on 'ready-to-show': if win_x/win_y set, clamp against `screen.getPrimaryDisplay().workArea` (keep window fully on-screen), then `win.setPosition`.
- Close behavior: if hide_to_tray && tray_enabled → `win.hide()` + tray balloon-style menu Show/Quit; else app quits. Tray menu: "Show DVC", separator, "Quit".
- Linux caveat: AppIndicator trays need `libappindicator`; wrap Tray creation in try/catch — on failure log once and continue with no tray (hide_to_tray then falls back to real quit).

- [ ] Step 1: unit-test what is testable without a real BrowserWindow: position clamp math extracted as pure `clampToWorkarea(x,y,w,h,workArea)` export (test: window left of screen clamps to 0; bottom-right clamps; exact fit untouched). Tray/close logic covered by code review (Electron APIs untestable in vitest).
- [ ] Step 2: implement service + wire in index.js (create window → service.attach(win)); profile:save handler calls `windowService.applySettings()` when patch touches always_on_top/tray_enabled.
- [ ] Step 3: build + tests green; commit "feat: tray, window position persistence, always-on-top".

---

### Task 3: Stats dialog

**Files:**
- Create: `src/renderer/src/features/stats/StatsDialog.jsx`, `stats.css`
- Modify: context menu (add "📊 Stats" entry opening it — reuse menuData), store (stats already present)

**Behavior (port of legacy stats_dialog.py):**
- Overlay dialog (same overlay pattern as SettingsOverlay): title "Stats", 10 rows.
- Each row: stat name (capitalized), color-coded bar (value/100; color stops: <30 `--acc3`→ use theme var mapping: <30 #9575cd-like → use `var(--acc2)`, 30-69 `var(--acc1)`, ≥70 gold #ffd700 — ruling: use theme vars, gold constant), numeric value, minus/plus buttons (lucide Minus/Plus) → `dvc.invoke('stats:adjust',{key,delta:∓5})`; optimistic store update; push `stats` reconciles.
- Close: X button + Escape. Buttons aria-labeled.

- [ ] Step 1: component + css; wire menu entry.
- [ ] Step 2: build green; commit "feat: stats dialog with ±5 controls".

---

### Task 4: Memory tab (real content) + message limit

**Files:**
- Modify: `src/renderer/src/features/settings/SettingsOverlay.jsx` (replace Memory placeholder), store

**Memory tab content:**
- Session traits list: each row = trait text + trash icon (lucide Trash2) → `memory:delete-trait {text}`; "Wipe all" button (confirm via inline two-step: button turns red "Really?" on first click).
- Permanent facts list: same pattern (`memory:delete-permanent` / wipe).
- Session summary block: shows save.session_summary or "(none yet)" + "Clear" button.
- Chat history viewer: "Show history" toggle → fetches `history:get`, renders role-tagged lines (user=--acc1, assistant=--txt2), "Clear history" button.
- Message limit slider: 4..50 bound to config.max_history via profile:save patch; live label.

- [ ] Step 1: implement; all destructive buttons two-step confirmed.
- [ ] Step 2: build green; commit "feat: memory tab viewer with wipe controls and message limit".

---

### Task 5: QoL batch — SFX, regenerate/copy, shortcuts, General tab additions, font scale

**Files:**
- Create: `src/renderer/src/lib/sfx.js` (WebAudio synth)
- Modify: `ChatPanel.jsx` (regenerate + copy buttons), `Companion.jsx`/`App.jsx` (Ctrl+, shortcut), `SettingsOverlay.jsx` General tab, `store.js` (font_scale applied to CSS var), `global.css` (font-size calc var), context menu (Regenerate entry optional — ruling: buttons only, no menu entry)

**sfx.js contract:** `playSfx(name)` where name ∈ blip|notify|statUp|statDown|error; synthesizes via OscillatorNode with envelopes ported from legacy `legacy/audio/audio.py::gen_sounds` (blip 600Hz .04s; notify 880→440 sweep .15s; statUp 523→1047 .2s; statDown 1047→262 .2s; error 150Hz .3s; gain ~0.2, exponential ramp out). Reads `config.ui_sounds` from store; no-op when off. Lazy AudioContext on first call.

**ChatPanel additions:** small icon buttons right of send: RotateCcw "Regenerate" (enabled when not busy and lastUserText exists → `msg:regenerate`), Copy "Copy reply" (clipboard.writeText(bubbleText), shows 1s Check icon). Both aria-labeled, 28px.

**Shortcuts:** Ctrl+, opens settings (App-level keydown listener, ignored when typing in inputs is FALSE — allow it anyway, ruling: always open). Escape already closes overlays.

**General tab additions:** toggles → always_on_top, tray_enabled, ui_sounds (persist via profile:save; always_on_top/tray take effect immediately via push? — ruling: apply on Save like other fields; ipc already calls windowService.applySettings on save). "Redo setup wizard" button (confirm two-step → `setup:redo` → store.setupComplete=false). "Factory reset" button (two-step red → `profile:factory-reset` → reload window via location.reload()).

**Font scale:** slider 0.85–1.3 step 0.05 in General tab → store.font_scale → `document.documentElement.style.setProperty('--font-scale', v)`; global.css: `html { font-size: calc(16px * var(--font-scale, 1)); }`; persisted on Save via profile:save {font_scale}.

- [ ] Step 1: sfx.js + wire into existing event points (reply start=notify, typing blip every 3rd char if enabled — throttle: only when bubble typing, stat changes=statUp/Down by delta sign, error chip=error).
- [ ] Step 2: ChatPanel buttons + shortcut + General tab + font scale.
- [ ] Step 3: build + tests green; commit "feat: QoL — sounds, regenerate/copy, shortcuts, font scale, general tab actions".

---

### Task 6: Verification

- [ ] `npm test` all green; `npx electron-vite build` clean
- [ ] Grep sweep: no console.log in new code; all new invoke channels present in preload allowlist AND ipc handlers (write a tiny test asserting allowlist set === handler set — add to tests/ipc.test.js)
- [ ] Update DEVELOPMENT_STATE.md: Plan 3 done, rulings, new keys, new channels
- [ ] Commit "docs: update development state for Plan 3"

## Self-Review

- Spec §4.4 stats dialog + memory dialog + msg limit → Tasks 3, 4. ✔
- Tray/polish pulled forward from phase 5 deliberately (ruling). ✔
- No placeholders; all channels/enums named. ✔
- Type consistency: channel names used identically in Tasks 1/3/4/5. ✔
