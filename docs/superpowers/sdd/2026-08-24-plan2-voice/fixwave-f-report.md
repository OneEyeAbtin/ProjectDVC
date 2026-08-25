# Fixwave F — Report (menus/window-buttons/sysprompt)

Branch `electron-rebuild`, base 9393388 → HEAD d51b2c7. Build green, **253/253 tests** (250 + 3 new).

## Commits
1. `3cc35e4` fix: instant menus — scope transitions, pause ambient under overlays, opaque menu bg
2. `e78262a` feat: tray-hide button, close always quits
3. `d51b2c7` feat: rewritten companion system prompt with enforced emotion format

## Workstream 1 — Menu/overlay slowness (all three fixes verified + applied)
- Diagnosis CONFIRMED: commit de13f99 added `.glass` transition `background-color .45s, border-color .45s, color .3s` (src/renderer/src/styles/global.css) and the ctx-menu uses `.glass` → 450ms fade-in on every open.
- (a) Transitions scoped OUT of menus/popovers: global.css now sets `transition: none` on `.ctx-menu`, `.ctx-sub`, `.ctx-row`, `.swatch-cell`, `.settings-panel`, `.stats-panel`. Row hover transitions (.12s) removed in context-menu.css. Chevron rotate kept. `.shell`/`.glass` keep the theme fade.
- (b) Ambient pause under overlays: store gained `contextMenuOpen` (+ setter); ContextMenu publishes open/close via its existing effect; AmbientBackground subscribes to `settingsOpen || statsOpen || contextMenuOpen` — when blocked it stops the starfield rAF loop (`controlsRef` start/stop) and adds `.ambient-paused` → `animation-play-state: paused` on all orbs (ambient.css). Resumes on close; respects document visibility; reduced-motion path untouched.
- (c) Context menu bg swapped to `color-mix(in srgb, var(--bg2) 92%, transparent)` + `backdrop-filter: none` (context-menu.css). Blur retained on settings/stats glass panels.

## Workstream 2 — Window buttons
- TopBar is now `[stats][gear][tray-hide][X]`; tray-hide = lucide `ArrowDownFromLine`, aria-label "Minimize to tray", invokes NEW channel `win:hide`.
- `win:hide` added to preload INVOKE_CHANNELS + ipc handler (guards destroyed win / missing hide). Covered by the existing bidirectional allowlist↔handler parity test PLUS new behavior tests (hides window; tolerates destroyed/no-hide).
- X always quits: hide_to_tray gating removed from window.service close path (flush still runs via shared flusher, double-write guarded). "Hide to tray" toggle row did NOT exist in Settings General (settingsDraft.js/SettingsOverlay.jsx never exposed it) — nothing to remove there. Key stays in defaults, annotated as unused by close logic.
- DEVELOPMENT_STATE.md §8 item 2 + §4 architecture line updated for the new close behavior.

## Workstream 3 — System prompt rewrite
- sysPrompt() replaced verbatim per controller template (identity header w/ time-of-day, PERSONA — name:, NON-NEGOTIABLE FORMAT w/ example, EMOTIONS list, OPTIONAL TAGS, YOUR STATS, YOUR MEMORY, HARD RULES). Still one string; placeholders filled from same sources (pet/user names, persona+PERSONAS desc, DEFAULTS.emotions, stats line, memory.buildMemoryPrompt).
- New exported `timeOfDay(date)` helper (5-11 morning / 12-16 afternoon / 17-21 evening / else late night), computed in main from Date(); unit-tested across band edges.
- Offline fallback + MC stub untouched (confirmed they don't use sysPrompt).
- Tests updated: old fragments ("STRICT RULES", rule-9 wording, `MEMORY:` header, legacy opener) → new stable fragments ("NON-NEGOTIABLE FORMAT", "[EMOTION: name] — REQUIRED…", "HARD RULES:", memory-section header). No other test referenced old fragments.

## Concerns
- None blocking. Note: `.ambient-paused` freezes orbs but the starfield canvas keeps its last painted frame while blocked (intended — static under overlay).
- `hide_to_tray: true` remains in defaults.js SETTINGS_KEYS for migration compat; intentionally dead.
