import { EventEmitter } from 'node:events'

class Bus extends EventEmitter {}
export const bus = new Bus()
bus.setMaxListeners(50)
export const emit = (topic, payload) => bus.emit(topic, payload)
export const on = (topic, fn) => { bus.on(topic, fn); return () => bus.off(topic, fn) }
