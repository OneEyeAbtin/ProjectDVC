import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// 'piper' on PATH for linux; bundled piper.exe in assets/tts/ first, then
// PATH, on Windows.
function findPiperBinary(assetsTtsDir) {
  if (process.platform === 'win32') {
    const local = path.join(assetsTtsDir, 'piper.exe')
    if (fs.existsSync(local)) return local
    return 'piper.exe'
  }
  return 'piper'
}

export async function synthesize({ text, outPath, cfg }) {
  const model = cfg?.voice
  if (!model || !fs.existsSync(model)) {
    throw new Error('Piper voice model not found — pick one in Settings → Voice.')
  }

  const exe = findPiperBinary(cfg?.assets_tts_dir || path.join('assets', 'tts'))
  await new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(exe, ['--model', model, '--output_file', outPath], { windowsHide: true })
    } catch {
      reject(new Error("Piper binary not found — install 'piper' or place piper.exe in assets/tts/."))
      return
    }
    // EPIPE when piper exits before reading all stdin — surfaced via close.
    child.stdin.on('error', () => {})
    child.on('error', () => {
      reject(new Error("Piper binary not found — install 'piper' or place piper.exe in assets/tts/."))
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Piper failed (exit code ${code ?? 'unknown'}).`))
    })
    child.stdin.write(text)
    child.stdin.end()
  })

  if (!fs.existsSync(outPath)) {
    throw new Error('Piper failed — no output file was produced.')
  }
  return outPath
}
