# ProjectDVC 2.0 — Plan 1: Scaffold → Core Companion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Python cortex with an Electron+React app that boots, migrates old data, runs the setup wizard, and holds a full chat conversation with emotion-driven sprite swapping.

**Architecture:** Electron main process hosts services (config/memory/brain/persona/characters) talking over an internal event bus; React renderer is a pure view behind a contextBridge IPC contract (`window.dvc`).

**Tech Stack:** Electron 33+, electron-vite, React 18, zustand, lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-electron-rebuild-design.md`

## Global Constraints

- Node ≥ 20 (machine has 22). Plain JavaScript — no TypeScript.
- Renderer has NO Node access: `contextIsolation: true`, `nodeIntegration: false`.
- All persisted files live under `data/`. Never write to `assets/` at runtime.
- Legacy Python code moves to `legacy/` — never deleted.
- Emotions (19): neutral happy sad angry blush thinking love sleepy excited confused bored annoyed evil eyeroll mocking smirk shocked disgusted talking
- LLM tag contract: `[EMOTION: name]`, `[TRAIT: fact]`, `[STAT: name ±N]`
- Stats keys (10): affection rizz nerdiness sass chaos loyalty creativity wisdom humor romance
- IPC channels (v1): invoke: `app:init`, `setup:complete`, `msg:send`, `profile:save`, `outfit:switch`, `cheat:try`; push: `reply`, `emotion`, `stats`, `traits`, `memory`, `error`

---

### Task 1: Repo restructure

**Files:** Move `core/ gui/ audio/ ProjectDVC.bat app_output.txt lines.txt path_lines.txt` → `legacy/`. Update `.gitignore`.

- [ ] **Step 1:**

```bash
mkdir -p legacy/artifacts
git mv core gui audio legacy/
git mv ProjectDVC.bat legacy/
git mv app_output.txt lines.txt path_lines.txt legacy/artifacts/
```

Keep at root: `assets/ data/ drone/ dvc_profile.json traits.txt docs/ README.md AGENTS.md CLAUDE.md .gitignore`

- [ ] **Step 2:** Append to `.gitignore`: `node_modules/`, `out/`, `dist/`, `dist-electron/`, `data/tts-cache/`, `*.log`

- [ ] **Step 3: Verify** — root has no `core/`; `legacy/core/main.py` exists.

---

### Task 2: Scaffold Electron + React + Vite

**Files:** Create `package.json`, `electron.vite.config.js`, `src/main/index.js`, `src/preload/api.js`, `src/renderer/index.html`, `src/renderer/src/main.jsx`, `src/renderer/src/App.jsx`, `src/renderer/src/styles/global.css`

- [ ] **Step 1: package.json**

```json
{
  "name": "projectdvc",
  "version": "2.0.0",
  "description": "Desktop Virtual Companion",
  "main": "out/main/index.js",
  "author": "Abtin",
  "license": "UNLICENSED",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "string-similarity-js": "^2.1.4",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "electron": "^33.2.0",
    "electron-vite": "^2.3.0",
    "lucide-react": "^0.468.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: electron.vite.config.js**

```js
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
    build: { rollupOptions: { input: 'src/renderer/index.html' } }
  }
})
```

Note: electron-vite defaults roots are `src/` entries; set explicit input as above so renderer resolves at `src/renderer/index.html`.

- [ ] **Step 3: src/main/index.js**

```js
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerIpc } from './ipc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let win

function createWindow() {
  win = new BrowserWindow({
    width: 400, height: 700,
    frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/api.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => { registerIpc(); createWindow() })
app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 4: src/preload/api.js**

```js
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dvc', {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (channel, callback) => {
    const handler = (_e, data) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
})
```

- [ ] **Step 5: renderer skeleton**

`src/renderer/index.html`:

```html
<!doctype html>
<html lang="en" data-theme="midnight-sakura">
  <head><meta charset="UTF-8" /><title>ProjectDVC</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>
</html>
```

`src/renderer/src/main.jsx`:

```jsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles/global.css'

createRoot(document.getElementById('root')).render(<App />)
```

`src/renderer/src/App.jsx`:

```jsx
export default function App() {
  return <div className="shell"><h1 style={{margin:'auto'}}>DVC 2.0</h1></div>
}
```

- [ ] **Step 6: src/renderer/src/styles/global.css**

```css
@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600&family=Nunito+Sans:wght@300;400;600;700&display=swap');

* { margin: 0; padding: 0; box-sizing: border-box; user-select: none; }
html, body, #root { height: 100%; background: transparent; overflow: hidden;
  font-family: 'Nunito Sans', sans-serif; }

.shell { height: 100%; display: flex; flex-direction: column; border-radius: 18px;
  overflow: hidden; color: var(--txt1);
  background: linear-gradient(170deg, var(--bg2), var(--bg1));
  border: 1px solid var(--border); }
.glass { background: color-mix(in srgb, var(--bg3) 72%, transparent);
  backdrop-filter: blur(15px); border: 1px solid var(--border); }
button { cursor: pointer; font-family: inherit; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

Also create temporary stub `src/main/ipc.js` exporting `registerIpc(){}` so the app boots; replaced in Task 8.

- [ ] **Step 7: Verify** — `npm install && npm run dev` → frameless always-on-top window shows "DVC 2.0".

---

### Task 3: Themes CSS (12 palettes)

**Files:** Create `src/renderer/src/styles/themes.css`; import from global.css top.

- [ ] **Step 1:** Port all 12 palettes from `legacy/gui/theme.py` THEMES into `[data-theme='id']` blocks. IDs kebab-case: midnight-sakura, crimson-abyss, ocean-dream, forest-dusk, synthwave, arctic-ghost, darkwave, matrix, ethereal, neon-city, amber-terminal, gold. Each block maps BG1..BG4→--bg1..4, ACC1..3→--acc1..3, TXT1/2→--txt1/2, BORDER→--border. Duplicate midnight-sakura values into `:root` as default.

Example:

```css
[data-theme='midnight-sakura'] {
  --bg1:#0d0816; --bg2:#1a1025; --bg3:#2d1f3d; --bg4:#3d2a54;
  --acc1:#ff6b9d; --acc2:#c084fc; --acc3:#67e8f9;
  --txt1:#f0e6ff; --txt2:#b8a5d4; --border:rgba(192,132,252,.25);
}
```

- [ ] **Step 2:** Add `@import './themes.css';` as FIRST line of global.css (must precede other rules).
- [ ] **Step 3: Verify** — flip `data-theme="matrix"` in index.html, colors change on dev run, revert.

---

### Task 4: Bus + defaults + persona data

**Files:** Create `src/main/bus.js`, `src/main/data/defaults.js`, `src/main/data/personas.js`. Tests: `tests/bus.test.js`, `tests/persona-data.test.js`.

- [ ] **Step 1: src/main/bus.js**

```js
import { EventEmitter } from 'node:events'

class Bus extends EventEmitter {}
export const bus = new Bus()
bus.setMaxListeners(50)
export const emit = (topic, payload) => bus.emit(topic, payload)
export const on = (topic, fn) => { bus.on(topic, fn); return () => bus.off(topic, fn) }
```

- [ ] **Step 2: defaults.js** — Port verbatim from `legacy/core/config.py::_DEFAULTS`: all api/tts/stt/elevenlabs keys, max_history:20, setup_questions (20 items), interactions map, emotions array. Omit `minecraft` → add `minecraft_v2:null`. Add `theme_id:'midnight-sakura'`. Export `SETTINGS_KEYS` (config-side keys) and `SAVE_KEYS = ['user_name','pet_name','persona','outfit','brain_mode','stats','tts_enabled','tts_engine','lip_sync_tts','lip_sync_text','selected_offline_voice','hearts_visible','setup_complete','setup_answers','last_emotion','theme_id']`.

- [ ] **Step 3: personas.js** — Export from `legacy/core/config.py` personas dict → `PERSONAS` (23 entries verbatim), from `legacy/core/constants.py` → `PERSONA_GROUPS`, `GREETINGS` (_GREETS keyed by persona name), `DEAD_MSGS`, `DEEP_MAP`, `EMO_REMAP`, `INTERACT_MENU`, `OFFLINE_FALLBACKS` (the random pool from `_fallback` in main.py).

- [ ] **Step 4: tests**

```js
// tests/bus.test.js
import { it, expect } from 'vitest'
import { emit, on } from '../src/main/bus.js'
it('delivers and unsubscribes', () => {
  let n = 0
  const off = on('t:x', v => (n += v))
  emit('t:x', 2); off(); emit('t:x', 5)
  expect(n).toBe(2)
})
```

```js
// tests/persona-data.test.js
import { describe, it, expect } from 'vitest'
import { PERSONAS, PERSONA_GROUPS, EMO_REMAP } from '../src/main/data/personas.js'

describe('persona data integrity', () => {
  it('has 23 personas with descriptions', () => {
    expect(Object.keys(PERSONAS).length).toBe(23)
    for (const d of Object.values(PERSONAS)) expect(d.length).toBeGreaterThan(30)
  })
  it('grouped personas all exist', () => {
    for (const members of Object.values(PERSONA_GROUPS))
      for (const m of members) expect(PERSONAS[m]).toBeDefined()
  })
  it('remap targets valid', () => {
    const valid = new Set(['neutral','happy','sad','angry','blush','thinking','love','sleepy','excited','confused','bored','annoyed','evil','eyeroll','mocking','smirk','shocked','disgusted'])
    for (const t of Object.values(EMO_REMAP)) expect(valid.has(t)).toBe(true)
  })
})
```

- [ ] **Step 5:** `npm test` → green.

---

### Task 5: Config service + migration

**Files:** Create `src/main/services/config.service.js`. Test: `tests/config.test.js`.

Interfaces produced: `createConfigService({ rootDir })` → `{ getConfig, getSave, patchConfig, patchSave, migrateLegacyIfNeeded }`. Files: `data/config.json`, `data/save.json`. SAVE_KEYS/SETTINGS_KEYS come from defaults.js.

- [ ] **Step 1: failing tests** (use real temp dirs):

```js
// tests/config.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createConfigService } from '../src/main/services/config.service.js'

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('config service', () => {
  it('creates defaults on fresh root', () => {
    const svc = createConfigService({ rootDir: dir })
    svc.migrateLegacyIfNeeded()
    expect(svc.getConfig().max_history).toBe(20)
    expect(svc.getSave().stats.affection).toBe(20)
    expect(fs.existsSync(path.join(dir, 'data/config.json'))).toBe(true)
  })

  it('migrates legacy profile/traits/facts and is idempotent', () => {
    fs.writeFileSync(path.join(dir, 'dvc_profile.json'), JSON.stringify({
      user_name: 'Abtin', pet_name: 'Raven', persona: 'Vampire',
      stats: { affection: 55 }, theme: 'Matrix',
      tts: { enabled: true, engine: 'online', online_voice: 'x' },
      max_history: 12
    }))
    fs.writeFileSync(path.join(dir, 'traits.txt'), 'user likes coffee\nuser studies engineering\n')
    fs.mkdirSync(path.join(dir, 'data'))
    fs.writeFileSync(path.join(dir, 'data/permanent_facts.json'), JSON.stringify(['user fears heights']))

    const svc = createConfigService({ rootDir: dir })
    svc.migrateLegacyIfNeeded()
    svc.migrateLegacyIfNeeded() // idempotent

    expect(svc.getSave().persona).toBe('Vampire')
    expect(svc.getConfig().max_history).toBe(12)
    expect(svc.getSave().stats.affection).toBe(55)
    expect(JSON.parse(fs.readFileSync(path.join(dir,'data/memory/session-traits.json')))).toHaveLength(2)
    expect(JSON.parse(fs.readFileSync(path.join(dir,'data/memory/permanent-facts.json')))[0]).toBe('user fears heights')
    // theme name→id mapping applied
    expect(svc.getSave().theme_id).toBe('matrix')
    // legacy untouched
    expect(fs.existsSync(path.join(dir, 'dvc_profile.json'))).toBe(true)
  })

  it('patchSave merges deep (stats)', () => {
    const svc = createConfigService({ rootDir: dir })
    svc.migrateLegacyIfNeeded()
    svc.patchSave({ stats: { affection: 99 } })
    expect(Object.keys(svc.getSave().stats)).toHaveLength(10)
    expect(svc.getSave().stats.affection).toBe(99)
    expect(svc.getSave().stats.humor).toBeDefined()
  })
})
```

- [ ] **Step 2: implement** `config.service.js`:
  - `loadJson(file, fallback)` guarded try/catch.
  - `deepMerge(base, patch)` — plain objects merged recursively, scalars replaced.
  - On init: ensure `data/` + `data/memory/` exist; load config+save filling missing keys from defaults (structuredClone).
  - `migrateLegacyIfNeeded()`: if `dvc_profile.json` exists AND no `data/.migrated` marker → read legacy, split into settings/save by SETTINGS_KEYS/SAVE_KEYS (map legacy `theme` display name → kebab id via THEMES_NAME_TO_ID table exported from themes map in main data), write both files, move traits.txt lines → session-traits.json, copy permanent_facts.json → permanent-facts.json, write `.migrated` marker containing timestamp.
  - All writes atomic: write `.tmp` then `fs.renameSync`.
- [ ] **Step 3:** `npm test` → green.

---

### Task 6: Memory service

**Files:** Create `src/main/services/memory.service.js`. Test: `tests/memory.test.js`.

Interfaces produced: `createMemoryService({ rootDir, config })` → `{ getPermanent, getSessionTraits, addTrait(trait), setSessionTraits(list), rotateAndSave(), buildMemoryPrompt(save), classifyTrait(trait), needsCompression(), cacheHistory(hist), popPendingSummary(), restorePendingSummary(raw) }`.

- [ ] **Step 1: failing tests**

```js
// tests/memory.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { createMemoryService } from '../src/main/services/memory.service.js'

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-mem-')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
const svc = () => createMemoryService({ rootDir: dir })

describe('memory', () => {
  it('dedups near-duplicates keeping longer', () => {
    const s = svc()
    s.setSessionTraits(['user likes coffee', 'user enjoys coffee', 'user hates rain'])
    expect(s.getSessionTraits()).toEqual(['user likes coffee', 'user hates rain'])
  })
  it('classifies identity facts permanent vs session', () => {
    const s = svc()
    expect(s.classifyTrait("user's name is Abtin")).toBe('permanent')
    expect(s.classifyTrait('user had a sandwich today')).toBe('session')
  })
  it('caps session traits at 30 keeping recent', () => {
    const s = svc()
    s.setSessionTraits(Array.from({length: 35}, (_, i) => `fact number ${i} unique`))
    s.rotateAndSave()
    expect(s.getSessionTraits()).toHaveLength(30)
    expect(s.getSessionTraits()[0]).toContain('fact number 5')
  })
  it('builds prompt with profile/learned/summary sections', () => {
    const s = svc()
    s.addTrait('user likes tea')
    const save = { setup_answers: { hobby: 'gaming' }, session_summary: 'talked about pizza' }
    const p = s.buildMemoryPrompt(save)
    expect(p).toContain('hobby: gaming')
    expect(p).toContain('user likes tea')
    expect(p).toContain('talked about pizza')
  })
})
```

- [ ] **Step 2: implement**
  - Similarity via `string-similarity-js` `similarity(a,b)` ≥ 0.82 → dup; keep longer string.
  - Permanent prefixes list ported from legacy `_PERM_PREFIXES`; plus keyword heuristic from `classify_trait` (name/age/hobby/likes/loves/hates/prefers/is a… under 80 chars).
  - Files: `data/memory/permanent-facts.json`, `data/memory/session-traits.json`, `data/memory/session-cache.json`.
  - `buildMemoryPrompt`: "Profile: k: v; …" from setup_answers + "Permanent facts:" bullets + last-10 session notes + "Last session:" summary. Skip traits whose tail matches a setup answer value.
  - `cacheHistory(hist)` writes last 20; `popPendingSummary()` reads+deletes cache atomically.
- [ ] **Step 3:** tests green.

---

### Task 7: Characters service

**Files:** Create `src/main/services/characters.service.js`. Test: `tests/characters.test.js`.

Interfaces produced: `createCharactersService({ outfitsDir, emotions })` → `{ scan(), manifest(), resolveSprite(outfitPrefix, emotion) }`. `scan()` returns `{ stem: absPath }` map + auto-registers prefix→display-name entries.

- [ ] **Step 1: failing test** — seed temp outfits dir with `Charlotthappy.png`, `Charlotneutral.png`, `neutral.png`, `fullbody.png`; assert:
  - stems detected; prefix `charlot` inferred for files ending in known emotions
  - `resolveSprite('charlot','happy')` returns the happy path; missing emotion falls back prefix+`neutral` → bare emotion → `neutral`
  - manifest groups by prefix with counts

- [ ] **Step 2: implement** — scan reads dir once per call (caller caches); prefix detection: stem endsWith any of ALL_EMOTIONS (19 + fullbody) and length > suffix → prefix = stem.slice(0,-suffix.length). Display name = prefix capitalized or 'Base' when empty.
- [ ] **Step 3:** green.

---

### Task 8: Brain service + LLM provider + tag parsing

**Files:** Create `src/main/services/brain.service.js`, `src/main/providers/llm.js`. Test: `tests/brain.test.js`.

Interfaces produced: `parseTags(text, { stats, emotions })` → `{ clean, emotion, statDeltas:[{key,delta}], traits:[], remappedEmotion }`; `createBrain({ config, memory, personaName })` → `{ send(text), history, sysPrompt() }`. Provider: `callLLM({ url, key, model, messages, timeoutMs })` using global fetch.

- [ ] **Step 1: failing tests** (pure logic first):

```js
// tests/brain.test.js (tag section)
import { describe, it, expect } from 'vitest'
import { parseTags } from '../src/main/services/brain.service.js'

const stats = { affection: 20, sass: 15 }

describe('parseTags', () => {
  it('extracts emotion, strips tags, applies remap', () => {
    const r = parseTags('Hmph! Whatever. [EMOTION: smug]', { stats })
    expect(r.clean).toBe('Hmph! Whatever.')
    expect(r.emotion).toBe('smirk') // smug→smirk via EMO_REMAP
  })
  it('applies stat deltas clamped 0..100', () => {
    const r = parseTags('nice [STAT: affection +5] [STAT: sass -50]', { stats })
    expect(r.statDeltas).toEqual([{key:'affection',delta:5},{key:'sass',delta:-50}])
    expect(r.applyTo(stats)).toEqual({ ...stats, affection: 25, sass: 0 })
  })
  it('falls back to deep-scan keywords then neutral', () => {
    expect(parseTags('wow amazing awesome!!', { stats }).emotion).toBe('excited')
    expect(parseTags('plain text', { stats }).emotion).toBe('neutral')
  })
  it('collects traits', () => {
    const r = parseTags('[TRAIT: user likes tea] ok!', { stats })
    expect(r.traits).toEqual(['user likes tea'])
  })
})
```

Provider test uses `vi.stubGlobal('fetch', …)` returning `{ ok:true, json:async()=>({choices:[{message:{content:'hi'}}]}) }`; asserts URL/headers/model body and error path throws friendly message.

- [ ] **Step 2: implement**
  - Regexes identical to v1 (`/\[STAT:\s*(\w+)\s*([+-]\d+)\]/gi` etc.). `applyTo(stats)` helper returned in result for caller convenience (clamped).
  - `sysPrompt()`: port v1 `_sys_prompt` rules verbatim (persona desc, stats line, 9 strict rules, MEMORY block from `memory.buildMemoryPrompt(save)`).
  - Modes: online/local → provider call; offline → pick from OFFLINE_FALLBACKS by regex table (ported `_fallback`), no network.
  - `send(text)`: push history, lazy-compress pending summary if present (fire-and-forget via memory + llm), call LLM, parseTags, apply stats/traits through bus emits, return reply payload.
- [ ] **Step 3:** green.

---

### Task 9: IPC wiring (main ⇄ renderer contract)

**Files:** Replace stub `src/main/ipc.js`. Modify `src/main/index.js` to instantiate services before `registerIpc({ services, win })`.

- [ ] **Step 1:** Instantiate: configSvc, memorySvc, charactersSvc, brainSvc at startup after `migrateLegacyIfNeeded()`.
- [ ] **Step 2:** Implement channels:

```js
// invoke handlers (ipcMain.handle)
'app:init'      -> boot state: { config, save, traits, permanentFacts,
                   outfitManifest, setupQuestions, personas: PERSONA_GROUPS,
                   themes: THEME_LIST }
'setup:complete'(answers) -> patch save (answers + derived user_name/pet_name +
                   trait lines per answer), set setup_complete=true, return save
'msg:send'({text})   -> cheat check first (ported _chk_cheat incl forceEMOTION);
                   if cheat handled -> emit matching events, ack {cheated:true};
                   else brain.send(text) async; on success emit 'reply'
                   {text: clean, emotion}, 'stats', 'traits'; ack {queued:true}
'profile:save'(patch)-> deep merge into config/save split by key; emit 'profile'
'outfit:switch'({name}) -> patch save.outfit; emit 'emotion' current
'voice:speak'({text,emotion}) -> STUB in plan 1: emit 'tts' {unsupported:true}
```

Push wiring: bus topics `emotion:set|stats:changed|traits:changed|reply:ready` forward to `win.webContents.send`.
- [ ] **Step 3:** Manual smoke via devtools console later (Task 12).

---

### Task 10: Renderer store + boot flow

**Files:** Create `src/renderer/src/state/store.js`, modify `App.jsx`.

- [ ] **Step 1: zustand store** with shape from spec §4.2 plus actions wired to `window.dvc.on(...)` subscriptions created once in `useBoot()` hook:

```jsx
// useBoot(): invokes 'app:init', seeds store, subscribes push channels:
//   reply -> set bubbleText/emotion + typing sequence start
//   emotion/stats/traits/error -> respective slices
```

- [ ] **Step 2:** App renders `<SetupWizard/>` when `!setupComplete` else `<Companion/>`; sets `document.documentElement.dataset.theme = theme_id` on change.

---

### Task 11: Setup wizard + companion page UI

**Files:** Create `src/renderer/src/features/setup/SetupWizard.jsx`, `src/renderer/src/features/companion/Companion.jsx`, `.../Portrait.jsx`, `.../ChatPanel.jsx`, `.../TopBar.jsx`, `.../useTypewriter.js`, `.../SpriteImage.jsx`.

Key behaviors (all styled with theme vars + glass):
- SetupWizard: emoji + question + input + progress bar; Enter advances; final calls `dvc.invoke('setup:complete', answers)`.
- TopBar: hearts row (10 hearts colored by affection stage — port color thresholds), name label (Fredoka), settings gear (placeholder alert for Plan 2), close button → `window.close()`.
- Portrait: `SpriteImage` renders current outfit+emotion via canvas greenscreen keyer (module-level Map cache keyed `${prefix}|${emotion}`); badges overlay emotion + outfit names.
- ChatPanel: bubble area (typewriter caret while typing, italic gray *actions* via asterisk regex like v1), MEM counter, input + send (lucide icons). Send disabled while `thinking`.
- useTypewriter: given target text, ticks every 18ms appending chars; exposes done flag; optional per-word talking toggle callback placeholder (used in Plan 2 voice phase).

- [ ] Steps: write components → `npm run dev` → complete wizard → verify greeting renders → send message (needs API configured; offline mode works without) → sprite swaps visible.

---

### Task 12: Context menu + settings shell (minimal)

**Files:** Create `features/menu/ContextMenu.jsx` (custom, absolutely positioned, closes on blur), `features/settings/SettingsOverlay.jsx` with tabs General/AI/Voice/Memory — Plan 1 implements **General** (names, brain mode select, theme picker grid of 12 swatches) and **AI** (url/key/model for online + local); Voice/Memory tabs render "Coming in next update" placeholders.

- [ ] Right-click anywhere on `.shell` opens menu: Outfits submenu (from manifest), Personas grouped, Theme picker, Settings, Interact (stub toast).
- [ ] Verify: switch theme live; switch persona persists after app restart (reads data/save.json).

---

### Task 13: Verification pass

- [ ] `npm test` all green
- [ ] `npm run dev`: fresh-data boot shows wizard; wizard completes; greeting typed out; offline chat round-trips with emotion swap; online mode round-trips if keys present in migrated profile; restart keeps persona/outfit/theme/emotion
- [ ] Migration path verified against real root `dvc_profile.json` (rename original to keep as backup reference only)

## Self-Review Notes

- Spec §3.2 channels ↔ Task 9 table match (voice:speak stubbed intentionally, full voice = Plan 2).
- All legacy constants referenced have exact source file paths cited.
- No TypeScript anywhere; no Node access in renderer.

