import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useStore } from '../src/renderer/src/state/store.js'
import {
  MC_CONSOLE_CAP,
  MC_HISTORY_CAP,
  classifyMcLine,
  mapMcError,
  itemIcon,
  botStatusLine,
  projectBlips,
  shouldAcceptRadar
} from '../src/renderer/src/features/minecraft/minecraftLogic.js'

// Store reads window.dvc lazily inside actions; this stub captures push
// handlers so tests can fire main-process events (mc-log / mc-status / …).
globalThis.window = globalThis.window || {}

const handlers = {}
let invokes = []

function stubDvc() {
  window.dvc = {
    invoke(channel, payload) {
      return new Promise((resolve, reject) => {
        invokes.push({ channel, payload, resolve, reject, settled: false })
      })
    },
    on(channel, fn) {
      handlers[channel] = fn
      return () => delete handlers[channel]
    }
  }
}

function pendingInvoke(channel) {
  for (let i = invokes.length - 1; i >= 0; i--) {
    if (invokes[i].channel === channel && !invokes[i].settled) return invokes[i]
  }
  return undefined
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0)
}

describe('minecraft renderer UI', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    for (const key of Object.keys(handlers)) delete handlers[key]
    invokes = []
    stubDvc()
    useStore.setState({
      booted: true,
      error: null,
      thinking: false,
      typing: false,
      bubble: null,
      mcConnected: false,
      mcConnecting: false,
      mcTab: 0,
      mcConsole: [],
      mcRadar: [],
      mcInventory: [],
      mcBotStatus: null,
      mcCmdHistory: [],
      _unsubs: [],
      _errorTimer: null,
      _transientTimer: null,
      _mcConnectTimer: null,
      _mcSeq: 0,
      _lastRadarAt: 0
    })
    // booted:true → boot() only (re)subscribes the push handlers.
    void useStore.getState().boot()
  })

  afterEach(() => {
    useStore.getState()._teardown()
    vi.useRealTimers()
  })

  describe('tab switching', () => {
    it('switches between chat, console, radar and inventory', () => {
      const { setMcTab } = useStore.getState()
      setMcTab(2)
      expect(useStore.getState().mcTab).toBe(2)
      setMcTab(1)
      expect(useStore.getState().mcTab).toBe(1)
      setMcTab(0)
      expect(useStore.getState().mcTab).toBe(0)
    })

    it('ignores out-of-range and duplicate tab ids', () => {
      const { setMcTab } = useStore.getState()
      setMcTab(9)
      setMcTab(-1)
      setMcTab('nope')
      expect(useStore.getState().mcTab).toBe(0)
      setMcTab(3)
      setMcTab(3)
      expect(useStore.getState().mcTab).toBe(3)
    })
  })

  describe('console log cap + classification', () => {
    it('caps the console at MC_CONSOLE_CAP lines, dropping the oldest', () => {
      const s = useStore.getState()
      for (let i = 0; i < MC_CONSOLE_CAP + 25; i++) s.pushMcLog(`line ${i}`)
      const consoleLines = useStore.getState().mcConsole
      expect(consoleLines.length).toBe(MC_CONSOLE_CAP)
      expect(consoleLines[0].text).toBe('line 25')
      expect(consoleLines.at(-1).text).toBe(`line ${MC_CONSOLE_CAP + 24}`)
    })

    it('classifies lines into ok/err/warn/default tones', () => {
      expect(classifyMcLine('[MC] Connected to bot WS')).toBe('ok')
      expect(classifyMcLine('[BOT ERROR] boom')).toBe('err')
      expect(classifyMcLine('[MC] Reconnecting in 3s…')).toBe('warn')
      expect(classifyMcLine('drone stdout noise')).toBe('')
    })

    it('drops empty log payloads', async () => {
      void useStore.getState().boot()
      await flush()
      // settle app:init
      const init = pendingInvoke('app:init')
      if (init) init.resolve({ save: {} })
      await flush()

      handlers['mc-log']({})
      handlers['mc-log']({ line: '' })
      expect(useStore.getState().mcConsole).toEqual([])
      handlers['mc-log']({ line: '[MC] Connected' })
      expect(useStore.getState().mcConsole).toHaveLength(1)
    })
  })

  describe('connect / disconnect flow', () => {
    it('spinner stays up until the mc-status push lands', async () => {
      useStore.getState().mcConnect()
      expect(useStore.getState().mcConnecting).toBe(true)
      expect(pendingInvoke('mc:connect')?.channel).toBe('mc:connect')

      handlers['mc-status']({ connected: true })
      const s = useStore.getState()
      expect(s.mcConnected).toBe(true)
      expect(s.mcConnecting).toBe(false)
    })

    it('invoke rejection clears the spinner and raises a chip', async () => {
      useStore.getState().mcConnect()
      pendingInvoke('mc:connect').reject(new Error('channel closed'))
      await flush()
      const s = useStore.getState()
      expect(s.mcConnecting).toBe(false)
      expect(s.error?.scope).toBe('minecraft')
    })

    it('failsafe timer retires a wedged spinner after 12s', async () => {
      useStore.getState().mcConnect()
      await vi.advanceTimersByTimeAsync(11999)
      expect(useStore.getState().mcConnecting).toBe(true)
      await vi.advanceTimersByTimeAsync(10)
      expect(useStore.getState().mcConnecting).toBe(false)
    })

    it('disconnect is optimistic and still invokes main', () => {
      useStore.setState({ mcConnected: true })
      useStore.getState().mcDisconnect()
      expect(useStore.getState().mcConnected).toBe(false)
      expect(pendingInvoke('mc:disconnect')?.channel).toBe('mc:disconnect')
    })

    it('double-connect is a no-op while connecting or live', () => {
      useStore.getState().mcConnect()
      useStore.getState().mcConnect()
      expect(invokes.filter((i) => i.channel === 'mc:connect')).toHaveLength(1)

      handlers['mc-status']({ connected: true })
      useStore.getState().mcConnect()
      expect(invokes.filter((i) => i.channel === 'mc:connect')).toHaveLength(1)
    })

    it('connection errors surface as a friendly mapped chip', async () => {
      useStore.getState().boot() // booted:true → subscribes without re-invoking app:init
      await flush()

      handlers['mc-status']({ connected: false, error: 'connect ECONNREFUSED 127.0.0.1:25565' })
      const s = useStore.getState()
      expect(s.mcConnected).toBe(false)
      expect(s.error?.scope).toBe('minecraft')
      expect(s.error.message).toContain('refused — is the server on?')
    })
  })

  describe('console input (% history)', () => {
    it('sends text as typed and records % commands for recall', () => {
      const s = useStore.getState()
      s.mcSendRaw('%mine iron_ore')
      s.mcSendRaw('# hello bot')
      s.mcSendRaw('%come')

      const sent = invokes.filter((i) => i.channel === 'mc:send-raw')
      expect(sent.map((i) => i.payload)).toEqual([
        { text: '%mine iron_ore' },
        { text: '# hello bot' },
        { text: '%come' }
      ])
      expect(useStore.getState().mcCmdHistory).toEqual(['%mine iron_ore', '%come'])
      // Sent lines echo into the console with the cmd tone.
      const last = useStore.getState().mcConsole.at(-1)
      expect(last.text).toBe('→ %come')
      expect(last.tone).toBe('cmd')
    })

    it('history caps at MC_HISTORY_CAP entries', () => {
      const s = useStore.getState()
      for (let i = 0; i < MC_HISTORY_CAP + 10; i++) s.mcSendRaw(`%cmd${i}`)
      const hist = useStore.getState().mcCmdHistory
      expect(hist.length).toBe(MC_HISTORY_CAP)
      expect(hist[0]).toBe('%cmd10')
    })

    it('ignores blank sends entirely', () => {
      useStore.getState().mcSendRaw('   ')
      expect(invokes.filter((i) => i.channel === 'mc:send-raw')).toHaveLength(0)
      expect(useStore.getState().mcCmdHistory).toEqual([])
    })
  })

  describe('telemetry pushes', () => {
    it('radar snapshots throttle to one per 2s', () => {
      vi.setSystemTime(10_000)
      const s = useStore.getState()
      s._onMcRadar({ entities: [{ kind: 'hostile', name: 'zombie', x: 4, z: 2 }] })
      expect(useStore.getState().mcRadar).toHaveLength(1)

      vi.setSystemTime(11_000)
      s._onMcRadar({ entities: [{ kind: 'player', name: 'Abtin', x: 1, z: 1 }] })
      expect(useStore.getState().mcRadar).toHaveLength(1) // throttled

      vi.setSystemTime(12_500)
      s._onMcRadar({ entities: [{ kind: 'player', name: 'Abtin', x: 1, z: 1 }] })
      expect(useStore.getState().mcRadar).toHaveLength(1)
      expect(useStore.getState().mcRadar[0].kind).toBe('player')
    })

    it('inventory push stores items and tolerates garbage', async () => {
      useStore.getState().boot() // booted:true → subscribes without re-invoking app:init
      await flush()

      handlers['mc-inventory']({ items: [{ name: 'diamond', count: 3 }] })
      expect(useStore.getState().mcInventory).toEqual([{ name: 'diamond', count: 3 }])
      handlers['mc-inventory']({ items: 'junk' })
      expect(useStore.getState().mcInventory).toEqual([])
    })

    it('bot status push stores the status_update data object', async () => {
      useStore.getState().boot() // booted:true → subscribes without re-invoking app:init
      await flush()

      const data = { hp: 18, food: 20, x: 100, y: 64, z: -42, held: 'iron_pickaxe' }
      handlers['mc-bot-status']({ data })
      expect(useStore.getState().mcBotStatus).toEqual(data)
      handlers['mc-bot-status']({ data: 'junk' })
      expect(useStore.getState().mcBotStatus).toEqual(data) // unchanged
    })
  })
})

describe('minecraft pure helpers', () => {
  it('shouldAcceptRadar: first snapshot passes, later ones need the full window', () => {
    expect(shouldAcceptRadar(0, 5000)).toBe(true)
    expect(shouldAcceptRadar(5000, 6999)).toBe(false)
    expect(shouldAcceptRadar(5000, 7000)).toBe(true)
    expect(shouldAcceptRadar(undefined, Number.NaN)).toBe(false)
  })

  it('projectBlips ports legacy geometry (range clip, distance sizing, colors)', () => {
    const blips = projectBlips(
      [
        { kind: 'hostile', name: 'zombie', x: 8, z: 0 },
        { kind: 'player', name: 'Abtin', x: 0, z: 16 },
        { kind: 'hostile', name: 'far_mob', x: 40, z: 0 } // out of range
      ],
      64,
      32
    )
    expect(blips).toHaveLength(2)
    expect(blips[0]).toMatchObject({ x: 16, y: 0, dot: 5, kind: 'hostile' }) // scale 2
    expect(blips[1]).toMatchObject({ x: 0, y: 32, dot: 4, kind: 'player' }) // legacy: 5 - floor(16/10)
  })

  it('itemIcon maps keywords and falls back to ▪️', () => {
    expect(itemIcon('diamond_sword')).toBe('💎') // diamond wins over sword
    expect(itemIcon('iron_pickaxe')).toBe('⚙️')
    expect(itemIcon('cooked_beef')).toBe('🍗')
    expect(itemIcon('mystery_junk')).toBe('▪️')
  })

  it('botStatusLine formats hp/food/coords/held like legacy', () => {
    expect(botStatusLine({ hp: 18, food: 20, x: 100, y: 64, z: -42, held: 'iron_pickaxe' })).toBe(
      '❤️ HP: 18/20 · 🍖 20/20 · 📍 100 64 -42 · 🛡 iron_pickaxe'
    )
    expect(botStatusLine(null)).toContain('?')
  })

  it('mapMcError produces friendly copy for known failures', () => {
    expect(mapMcError('connect ETIMEDOUT 1.2.3.4')).toContain('timed out')
    expect(mapMcError('getaddrinfo ENOTFAIL mc.example.com')).toContain("Can't find that server")
    expect(mapMcError('version mismatch')).toContain('Version mismatch')
    expect(mapMcError('bot.js not found in the drone vault!')).toContain('bot.js not found')
    expect(mapMcError('')).toBe('Minecraft connection failed')
  })
})
