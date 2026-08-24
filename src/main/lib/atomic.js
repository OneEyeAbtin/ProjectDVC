import fs from 'node:fs'

// Atomic + durable write: tmp file, write, fsync (flush to disk before the
// rename — rename alone is atomic but not durable against power loss), then
// rename over the target. Shared by config.service, memory.service and ipc.js.
export function atomicWrite(file, data) {
  const tmp = `${file}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, data)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
}

export function writeJsonAtomic(file, obj) {
  atomicWrite(file, JSON.stringify(obj, null, 2))
}
