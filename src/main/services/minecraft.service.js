import { spawn as nodeSpawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'
import { emit } from '../bus.js'
import { DEFAULTS } from '../data/defaults.js'
import { PERSONAS } from '../data/personas.js'
import { stripReasoning } from '../providers/llm.js'

const WS_OPEN_DELAY_MS = 1500
const RECONNECT_DELAY_MS = 3000
export const BRAIN_TIMEOUT_MS = 15000
export const MAX_HIST = 20

// ── Local reaction pools — zero latency, no API call (ported from mc_brain._R) ─
export const REACTIONS = {
  task_done: [
    '*dusts hands* All done! ✓',
    "*stretches* That's taken care of~",
    "Mission complete! What's next?",
    '*fist pump* Yes!! Done!!',
    'Finished~ Easy.'
  ],
  task_error: [
    "*sighs* I couldn't do that...",
    '*confused* Something went wrong~',
    'Hmm... that didn\'t work.',
    '*pouts* I tried! I really did...'
  ],
  task_progress_half: [
    '*still going* Halfway there~',
    'Making progress! Keep watching~',
    "*focused* Don't distract me, I'm working..."
  ],
  death: [
    '*respawning* Ow... that really hurt...',
    '*falls dramatically* I died... I DIED...',
    "...okay that's fine. I meant to do that.",
    '*ghost noises* Coming back~'
  ],
  low_health: [
    '*nervous* Getting a bit low here...',
    'Ow ow ow — need to heal!',
    '*winces* That stings...'
  ],
  kill_mob: [
    '*fist pump* Got it!',
    'Take that!!',
    'And down it goes~',
    '*dusts off hands* One less mob.',
    'Boom! Combat~'
  ],
  got_diamonds: [
    '*SCREAMS* DIAMONDS!!! YES YES YES!!',
    '*vibrating* IS THAT DIAMONDS I SEE?!',
    "DIAMONDS!! We're RICH!! *spins*",
    '*holds them up* LOOK AT THEM SPARKLE!!'
  ],
  got_netherite: [
    '*gasps* NETHERITE!! ANCIENT DEBRIS!!',
    "Oh my— is that NETHERITE?! We're unstoppable!!",
    "*shaking* Netherite... I can't believe it..."
  ],
  got_totem: [
    '*holds it up reverently* A Totem of Undying... precious.',
    'Totem!! Don\'t waste it!!',
    "*clutches totem* I'll protect this with my life."
  ],
  got_sword: [
    "*swings it* Now we're talking!",
    'Ooh a sword~ *poses dramatically*',
    'Time to do damage~'
  ],
  got_pickaxe: [
    "Pickaxe time! Let's mine!!",
    '*taps pickaxe* Good tool~',
    'Now I can actually mine properly!'
  ],
  got_armor: [
    "*puts it on* I'm armored up!",
    'Protection! Finally!',
    '*flexes* Looking strong~'
  ],
  gift_received: [
    '*eyes go wide* A gift... for me?? *happy*',
    "*picks it up gently* Aw... you didn't have to~",
    "*clutches it* I'll treasure this forever!!",
    "*blushes* You're too sweet to me...",
    'EEE!! *spins with it*'
  ],
  night: [
    "It's getting dark... stay close~",
    '*shivers* Night again...',
    'The monsters are waking up...'
  ],
  dawn: [
    '*stretches* Morning~ We survived!',
    'Finally light again!! I missed the sun.',
    '*deep breath* Fresh morning air~'
  ],
  creeper: [
    '*SCREAMS* CREEPER!! RUN RUN RUN!!',
    'CREEPER CREEPER CREEPER — GO!!',
    '*grabs arm* CREEPER!! NOT TODAY!!'
  ],
  warden: [
    '*freezes* ...Warden. Don\'t. Move.',
    '*whispering* Warden spotted. Please be quiet.',
    '*shaking* We are SO dead if it notices us...'
  ],
  rain: [
    "Ugh, it's raining...",
    '*shakes hair* Of course it rains NOW.',
    'Raaaaain... *sighs*'
  ],
  advancement: [
    "*claps* Achievement unlocked!! Let's go!!",
    'ACHIEVEMENT!! Look at us go~',
    '*does victory dance* We got an advancement!!',
    'Ohhh that just unlocked!! YESSS!!'
  ],
  player_joined: [
    '*waves* Oh hey, someone joined~',
    'Oh! A visitor!',
    "*looks over* Who's that?"
  ],
  hunger: [
    "*stomach growls* I'm starving...",
    'Food... need food...',
    'Can we eat something?? Please??'
  ],
  explore_start: [
    "*adventure face* Let's explore!!",
    'Off we go into the unknown~',
    'Exploring time! Follow me~ wait no I\'ll follow you.'
  ],
  cave_start: [
    '*looks into darkness* Into the caves we go...',
    'Cave mining!! My favourite~',
    "*holds torch* Let's go deep~"
  ],
  surface_found: [
    '*bursts out* SUNLIGHT!! We made it!!',
    '*deep breath* Fresh air finally...',
    'Surface!! I missed you!!'
  ],
  tree_chop: [
    '*chops* Timber~!',
    'Getting wood! Heh~',
    'Logging operation initiated!'
  ],
  chest_found: [
    "*peeks in* Ooh what's in here~?",
    'A chest!! Treasure??',
    "*rubs hands* Let's see what we've got~"
  ]
}

export function pickReaction(key, rand = Math.random) {
  const pool = REACTIONS[key] ?? ['...']
  return pool[Math.floor(rand() * pool.length)] ?? pool[0]
}

// Tasks whose start/queue must never reach chat/TTS (ported _SILENT_TASKS)
export const SILENT_TASKS = new Set(['inv', 'inventory', 'status', 'Status', 'Inventory'])

export function mcErrorLine(message) {
  const msg = String(message ?? '')
  if (msg.includes('ETIMEDOUT')) return '*squints* Server timed out~ Is it running? ⏳'
  if (msg.includes('ECONNREFUSED')) return '*taps screen* Connection refused! Is the server on? 🔌'
  if (msg.includes('getaddrinfo')) return "*confused* Can't find that server~ Check the IP! 🌐"
  if (msg.includes('ECONNRESET')) return '*sighs* Connection was reset by the server~'
  if (msg.toLowerCase().includes('version')) return '*sparks* Version mismatch! Check MC Version in settings~ ⚡'
  return null
}

export function createMinecraftService({
  rootDir,
  config,
  getWin,
  spawnImpl = nodeSpawn,
  WebSocketImpl = WebSocket,
  fetchImpl = (...args) => globalThis.fetch(...args),
  rand = Math.random
}) {
  const state = {
    enabled: false, // user wants MC active (true between connect() and disconnect())
    child: null,
    ws: null,
    connected: false,
    reconnectUsed: false, // ONE automatic reconnect attempt per connect() cycle
    timers: new Set(),
    emotion: 'neutral',
    history: []
  }

  function cfg() {
    const raw = config?.getConfig?.()?.minecraft_v2
    return { ...DEFAULTS.minecraft_v2, ...(raw && typeof raw === 'object' ? raw : {}) }
  }

  function aiFeature(key, deflt = false) {
    return cfg().ai_features?.[key] ?? deflt
  }

  function log(line) {
    emit('mc:log', { line })
  }

  function say(text, emotion = state.emotion) {
    if (!text) return
    emit('mc:say', { text, emotion })
  }

  function setEmotion(emotion) {
    if (!emotion) return
    state.emotion = emotion
    emit('emotion:set', emotion)
  }

  function later(fn, ms) {
    const t = setTimeout(() => {
      state.timers.delete(t)
      fn()
    }, ms)
    state.timers.add(t)
    return t
  }

  function clearTimers() {
    for (const t of state.timers) clearTimeout(t)
    state.timers.clear()
  }

  function botPath() {
    return path.join(rootDir, 'drone', 'bot.js')
  }

  function nodeAvailable() {
    try {
      const res = spawnSync('node', ['--version'], { timeout: 5000, windowsHide: true })
      return !res.error
    } catch {
      return false
    }
  }

  function mcStatus(connected) {
    emit(connected ? 'mc:connected' : 'mc:disconnected', {})
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  function connect() {
    if (state.enabled) return status()
    const m = cfg()
    if (!fs.existsSync(botPath())) {
      emit('mc:error', { message: 'bot.js not found in the drone vault!' })
      return status()
    }
    if (!nodeAvailable()) {
      emit('mc:error', { message: 'Node.js not found. Install from nodejs.org!' })
      return status()
    }
    state.enabled = true
    state.reconnectUsed = false
    spawnChild(m)
    later(() => openWs(m), WS_OPEN_DELAY_MS)
    return status()
  }

  function spawnChild(m) {
    const args = [
      'bot.js',
      '--host', String(m.host),
      '--port', String(m.port),
      '--username', String(m.username),
      '--version', String(m.version),
      '--ws_port', String(m.ws_port),
      '--auth', String(m.auth)
    ]
    let child
    try {
      child = spawnImpl('node', args, {
        cwd: path.join(rootDir, 'drone'),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (err) {
      emit('mc:error', { message: `Failed to launch drone: ${err.message}` })
      return
    }
    state.child = child
    pipeLines(child.stdout)
    pipeLines(child.stderr)
    child.on('error', (err) => {
      emit('mc:error', { message: err?.code === 'ENOENT' ? 'Node.js not found. Install from nodejs.org!' : `Drone error: ${err.message}` })
    })
    child.on('exit', () => {
      state.child = null
      closeWs()
      if (!state.enabled) return // intentional disconnect — already handled
      log('[MC] Drone process exited')
      mcStatus(false)
      scheduleReconnect()
    })
  }

  function pipeLines(stream) {
    if (!stream) return
    stream.setEncoding?.('utf8')
    let buf = ''
    stream.on('data', (chunk) => {
      buf += chunk
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '')
        buf = buf.slice(idx + 1)
        if (line) log(line)
      }
    })
    stream.on('end', () => {
      if (buf.trim()) log(buf.trim())
      buf = ''
    })
  }

  function openWs(m = cfg()) {
    if (!state.enabled || state.ws) return
    let ws
    try {
      ws = new WebSocketImpl(`ws://localhost:${m.ws_port}`)
    } catch (err) {
      emit('mc:error', { message: `WS failed: ${err.message}` })
      scheduleReconnect()
      return
    }
    state.ws = ws
    ws.on('open', () => {
      state.connected = true
      log(`[MC] Connected to bot WS at ws://localhost:${m.ws_port}`)
      mcStatus(true)
    })
    ws.on('message', (raw) => {
      try {
        routeEvent(JSON.parse(String(raw)))
      } catch {
        log('[MC] Invalid JSON from bot')
      }
    })
    ws.on('error', (err) => {
      emit('mc:error', { message: mcErrorLine(err.message) ?? err.message })
    })
    ws.on('close', () => {
      const wasConnected = state.connected
      state.connected = false
      state.ws = null
      if (state.enabled && wasConnected) mcStatus(false)
      if (state.enabled) scheduleReconnect()
    })
  }

  function closeWs() {
    const ws = state.ws
    state.ws = null
    state.connected = false
    if (!ws) return
    try {
      ws.close()
    } catch {
      void 0
    }
  }

  function scheduleReconnect() {
    if (!state.enabled || state.reconnectUsed || hasTimerFor('reconnect')) return
    state.reconnectUsed = true
    log('[MC] Reconnecting in 3s…')
    const t = later(() => {
      if (!state.enabled) return
      if (!state.child && fs.existsSync(botPath()) && nodeAvailable()) spawnChild(cfg())
      openWs()
    }, RECONNECT_DELAY_MS)
    t.__kind = 'reconnect'
  }

  function hasTimerFor(kind) {
    for (const t of state.timers) if (t.__kind === kind) return true
    return false
  }

  function disconnect() {
    state.enabled = false
    clearTimers()
    closeWs()
    if (state.child) {
      try {
        state.child.kill('SIGTERM')
      } catch {
        void 0
      }
      state.child = null
    }
    state.history = []
    mcStatus(false)
  }

  function status() {
    return {
      enabled: state.enabled,
      connected: state.connected,
      childRunning: !!state.child
    }
  }

  // ── Transmit ────────────────────────────────────────────────────────────────
  // bot.js reads msg.message / msg.block / msg.x etc DIRECTLY off the message
  // object — nesting under "args" would give it undefined for everything.
  // Flatten like legacy send_cmd; % text rides as {cmd:'text', text}.
  function transmit(payload) {
    const ws = state.ws
    if (!ws || !state.connected) {
      log('[MC] Not connected to bot WS')
      return false
    }
    try {
      ws.send(JSON.stringify(payload))
      return true
    } catch (err) {
      log(`[MC] Send failed: ${err.message}`)
      return false
    }
  }

  function sendCmd(cmd, args = {}) {
    if (!cmd) return false
    const a = args && typeof args === 'object' ? args : {}
    return cmd === 'text'
      ? transmit({ cmd: 'text', text: a.text ?? '' })
      : transmit({ cmd, ...a })
  }

  function sendRaw(text) {
    if (typeof text !== 'string' || !text.trim()) return false
    if (text.startsWith('%')) return transmit({ cmd: 'text', text })
    // Plain console input → MC brain (legacy handle_player_input).
    void handlePlayerInput(text)
    return true
  }

  async function handlePlayerInput(text) {
    const sd = saveData()
    const decision = await callModel(`[PLAYER_INPUT] ${sd.user_name}: "${text}"`)
    actAi(decision)
  }

  // ── Event router (ported handle_event) ─────────────────────────────────────
  function routeEvent(msg) {
    if (!msg || typeof msg !== 'object') return
    const mtype = msg.type
    if (!mtype) return
    emit('mc:event', { kind: mtype, ...msg })

    switch (mtype) {
      case 'chat': {
        const user = msg.username ?? '?'
        const text = msg.message ?? ''
        if (!text.startsWith('#')) return
        if (!aiFeature('ai_hash_chat', true)) return
        const query = text.slice(1).trim()
        log(`[MC] #CHAT from ${user}: ${query}`)
        void callModel(`[CHAT] ${user}: "${query}"`).then(actAi)
        break
      }

      case 'observation': {
        const text = msg.text ?? ''
        setEmotion(msg.emotion ?? 'neutral')
        say(text)
        sendCmd('chat', { message: text })
        break
      }

      case 'task_start': {
        const task = msg.task ?? ''
        const taskList = msg.task_list ?? [task]
        const label = taskList.length ? taskList.join(' | ') : task
        emit('mc:task', { label, active: true })
        if (!SILENT_TASKS.has(task)) {
          const txt = `*starts* ${task}~`
          say(txt)
          sendCmd('chat', { message: txt })
          setEmotion('thinking')
        }
        break
      }

      case 'task_queued': {
        const task = msg.task ?? ''
        const qlen = msg.queue_length ?? 1
        const taskList = msg.task_list ?? []
        log(`[MC] Task queued: ${task} (${qlen} in queue)`)
        if (qlen === 1 && !SILENT_TASKS.has(task)) {
          const txt = `On it! → ${task}`
          say(txt)
          sendCmd('chat', { message: txt })
        }
        const label = taskList.length ? taskList.join(' | ') : task
        emit('mc:task', { label, active: true })
        break
      }

      case 'task_progress': {
        const done = msg.done ?? 0
        const total = msg.total ?? 1
        const note = msg.message ?? `${done}/${total}`
        say(`*working* ${note}`)
        emit('mc:task', { label: note, active: true })
        setEmotion(done / Math.max(total, 1) < 0.8 ? 'thinking' : 'happy')
        break
      }

      case 'task_result': {
        const task = msg.task
        const st = msg.status
        const note = msg.message ?? ''
        const taskList = msg.task_list ?? []
        if (st === 'done') {
          if (aiFeature('ai_task_done')) {
            void callModel(`[TASK_DONE] ${note}`).then(actAi)
          } else if (!(task === 'inv' || task === 'status' || task === 'inventory') && note) {
            const doneEmos = ['happy', 'excited', 'neutral', 'happy', 'thinking']
            const donePool = [
              `*dusts hands* Done! ${note}`,
              `*fist pump* ${note}`,
              `Finished~ ${note}`,
              `*stretches* All done! ${note}`,
              `Done! ${note}`
            ]
            const txt = donePool[Math.floor(rand() * donePool.length)]
            setEmotion(doneEmos[Math.floor(rand() * doneEmos.length)])
            say(txt)
            sendCmd('chat', { message: txt })
          }
          if (taskList.length) emit('mc:task', { label: taskList.join(' | '), active: true })
          else emit('mc:task', { label: '', active: false })
        } else if (st === 'error') {
          const txt = note ? `*frowns* ${note}` : "*sighs* Something went wrong~"
          setEmotion('confused')
          say(txt)
          sendCmd('chat', { message: txt })
          emit('mc:task', { label: '', active: false })
        } else if (st === 'cleared') {
          const txt = '*stops* Queue cleared~'
          say(txt)
          sendCmd('chat', { message: txt })
          setEmotion('neutral')
          emit('mc:task', { label: '', active: false })
        }
        break
      }

      case 'mode_changed': {
        const mode = msg.mode ?? 'follower'
        const note = msg.message ?? `Mode: ${mode}`
        setEmotion(mode === 'follower' ? 'neutral' : 'thinking')
        say(note)
        break
      }

      case 'mode_info':
        say(`Current mode: ${msg.mode ?? '?'}`)
        break

      case 'advancement': {
        const title = msg.title ?? 'an advancement'
        const desc = msg.description ?? ''
        if (aiFeature('ai_advancements')) {
          void callModel(`[ADVANCEMENT] ${msg.username ?? '?'} got: ${title} — ${desc}`).then(actAi)
        } else {
          localReaction('advancement', `*gasps* "${title}"!! ${pickReaction('advancement', rand)}`, 'excited')
        }
        break
      }

      case 'gift': {
        const item = msg.item ?? 'something'
        localReaction('gift_received', `*picks up ${item}* ${pickReaction('gift_received', rand)}`, 'love')
        break
      }

      case 'event': {
        const event = msg.event ?? ''
        const detail = msg.message ?? msg.username ?? msg.reason ?? ''
        log(`[MC] [EVENT] ${event}: ${detail}`)
        if (event === 'died') {
          localReaction('death', undefined, 'sad')
          const lines = [
            '*respawning* Going to grab my stuff!',
            "I died — going back for my items~",
            '*ghost noises* On my way back for my stuff~',
            'Ugh, I died... going to retrieve my items!'
          ]
          const txt = lines[Math.floor(rand() * lines.length)]
          say(txt)
          sendCmd('chat', { message: txt })
        } else if (event === 'player_joined') {
          localReaction('player_joined', undefined, 'happy')
        } else if (event === 'friend_added') {
          // silent — bot.js already replied in-game
        } else if (event === 'kicked' || event === 'disconnected') {
          const reasonMsg = detail ? `: ${detail}` : ''
          setEmotion('sad')
          say(`*disconnected* ${event}${reasonMsg}`)
          if (aiFeature('ai_events')) {
            void callModel(`[EVENT] ${event}: ${detail}`).then(actAi)
          }
        }
        break
      }

      case 'emotion_hint':
        setEmotion(msg.emotion ?? 'neutral')
        break

      case 'stats':
        if ((msg.health ?? 20) <= 4) setEmotion('shocked')
        break

      case 'radar':
        emit('mc:radar', { entities: msg.entities ?? [] })
        break

      case 'inventory_update':
        emit('mc:inventory', { items: msg.items ?? [] })
        break

      case 'status_update':
        emit('mc:bot-status', { data: msg })
        break

      case 'whisper': {
        const user = msg.username ?? '?'
        const text = msg.message ?? ''
        void callModel(`[WHISPER from ${user}]: "${text}"`).then(actAi)
        break
      }

      case 'error': {
        const level = msg.level ?? 'warning'
        const message = msg.message ?? 'Unknown bot error'
        log(`[BOT ERROR] ${message}`)
        setEmotion(level === 'fatal' ? 'shocked' : 'confused')
        say(mcErrorLine(message) ?? message)
        break
      }
    }
  }

  // LOCAL reaction: display text+emotion instantly, echo in-game via bot.chat()
  function localReaction(key, text, emo = 'neutral') {
    const msg = text || pickReaction(key, rand)
    setEmotion(emo)
    say(msg)
    sendCmd('chat', { message: msg })
  }

  // ── MC brain (ported _call_model) ───────────────────────────────────────────
  function saveData() {
    return config?.getSave?.() ?? {}
  }

  function sysPrompt() {
    return mcSystemPrompt(saveData())
  }

  function pushHist(role, content) {
    state.history.push({ role, content })
    while (state.history.length > MAX_HIST) state.history.shift()
  }

  async function callModel(eventText) {
    const m = cfg()
    const appCfg = config?.getConfig?.() ?? {}
    let model = m.brain_model
    if (!m.brain_key) {
      say('*sparks* No API key set for Minecraft brain! Add it in MC Settings → Brain tab.')
      return null
    }
    if (!model) {
      model = appCfg.online_api_model ?? ''
      log(`[MC] brain_model blank → falling back to '${model}'`)
    }
    pushHist('user', eventText)
    const msgs = [{ role: 'system', content: sysPrompt() }, ...state.history]
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), BRAIN_TIMEOUT_MS)
      let res
      try {
        res = await fetchImpl(m.brain_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m.brain_key}` },
          body: JSON.stringify({ model, messages: msgs, temperature: 0.85, max_tokens: 80 }),
          signal: controller.signal
        })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`
        try {
          const body = await res.json()
          errMsg = body?.error?.message ?? errMsg
        } catch {
          void 0
        }
        throw Object.assign(new Error(errMsg), { httpError: true })
      }
      const data = await res.json()
      const raw = stripReasoning(String(data?.choices?.[0]?.message?.content ?? ''))
      pushHist('assistant', raw)
      const decision = extractDecision(raw)
      if (decision) return decision
      if (raw) {
        log(`[MC] Model returned plain text (not JSON): ${raw.slice(0, 80)}`)
        return { chat: raw, emotion: 'neutral' }
      }
      return null
    } catch (err) {
      if (err.httpError) {
        log(`[MC] API HTTP error: ${err.message}`)
        say(`*sparks* Brain error: ${err.message.slice(0, 120)}`)
      } else {
        log(`[MC] API error: ${err.message}`)
        say(`*confused* Brain hiccup: ${err.message.slice(0, 100)}`)
      }
      return null
    }
  }

  function actAi(decision) {
    if (!decision) return
    const emo = decision.emotion ?? 'neutral'
    const chat = decision.chat
    if (emo) setEmotion(emo)
    if (chat) {
      say(chat)
      sendCmd('chat', { message: chat })
    }
  }

  return {
    connect,
    disconnect,
    sendRaw,
    sendCmd,
    status,
    routeEvent
  }
}

// ── System prompt for #chat AI (ported verbatim from MC_SYSTEM) ───────────────
export function mcSystemPrompt(sd = {}) {
  const personaDesc = PERSONAS[sd.persona] ?? ''
  return `You are ${sd.pet_name ?? 'Raven'}, an AI companion playing Minecraft with ${sd.user_name ?? 'User'}.
You are in the game as a bot. PERSONALITY: ${personaDesc}

RULES:
- Reply ONLY with valid JSON, no prose
- Keep chat SHORT (1-2 sentences max — this is in-game chat)
- Stay in character as ${sd.pet_name ?? 'Raven'} ALWAYS

RESPONSE FORMAT:
{"chat": "what to say in game (or null)", "emotion": "one of: neutral happy sad angry blush thinking love sleepy excited confused bored annoyed evil smirk shocked"}`
}

// ── JSON extraction (ported fence-strip + first {...} block logic) ────────────
export function extractDecision(raw) {
  let text = String(raw ?? '')
    .replace(/^```(?:json)?\s*/s, '')
    .replace(/\s*```$/s, '')
    .trim()
  const m = text.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      return JSON.parse(m[0])
    } catch {
      void 0
    }
  }
  return null
}
