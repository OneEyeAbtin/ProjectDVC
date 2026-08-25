import { contextBridge, ipcRenderer } from 'electron'

export const INVOKE_CHANNELS = new Set([
  'app:init',
  'setup:complete',
  'msg:send',
  'msg:regenerate',
  'profile:save',
  'profile:factory-reset',
  'setup:redo',
  'stats:adjust',
  'memory:delete-trait',
  'memory:wipe-traits',
  'memory:delete-permanent',
  'memory:wipe-permanent',
  'memory:clear-summary',
  'memory:export',
  'memory:import',
  'history:get',
  'history:clear',
  'outfit:switch',
  'characters:rescan',
  'cheat:try',
  'voice:speak',
  'voice:stop',
  'voice:stt-transcribe',
  'win:hide',
  'mc:connect',
  'mc:disconnect',
  'mc:send-raw',
  'mc:send-cmd'
])

export const PUSH_CHANNELS = new Set([
  'reply',
  'emotion',
  'stats',
  'traits',
  'memory',
  'error',
  'tts',
  'profile',
  'outfits',
  'mc-log',
  'mc-status',
  'mc-say',
  'mc-radar',
  'mc-inventory',
  'mc-bot-status',
  'mc-task'
])

contextBridge.exposeInMainWorld('dvc', {
  invoke: (channel, payload) => {
    if (!INVOKE_CHANNELS.has(channel)) return Promise.reject(new Error('Unknown channel'))
    return ipcRenderer.invoke(channel, payload)
  },
  on: (channel, callback) => {
    if (!PUSH_CHANNELS.has(channel)) throw new Error('Unknown channel')
    const handler = (_e, data) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
})
