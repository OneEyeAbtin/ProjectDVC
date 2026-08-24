import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

const DEFAULT_VOICE = 'en-US-AriaNeural'

// Edge Read Aloud API (no key required). Writes mp3 at outPath.
export async function synthesize({ text, outPath, cfg }) {
  const voice = cfg?.edge_voice || DEFAULT_VOICE
  const tts = new MsEdgeTTS({ enableLogger: false })
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const { audioStream } = tts.toStream(text)
    await pipeline(audioStream, fs.createWriteStream(outPath))
    return outPath
  } catch (err) {
    throw new Error(`Edge TTS failed: ${err.message}`)
  } finally {
    try {
      tts.close()
    } catch {
      void 0
    }
  }
}
