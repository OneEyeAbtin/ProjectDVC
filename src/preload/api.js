import { contextBridge, ipcRenderer } from 'electron'

const INVOKE_CHANNELS = new Set([
  'app:init',
  'setup:complete',
  'msg:send',
  'profile:save',
  'outfit:switch',
  'cheat:try',
  'voice:speak',
  'voice:stop'
])

const PUSH_CHANNELS = new Set([
  'reply',
  'emotion',
  'stats',
  'traits',
  'memory',
  'error',
  'tts',
  'profile'
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
