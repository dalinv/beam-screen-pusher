// 指标对照：区域 1280x720 双路（录制+回看）——验证分辨率与消费能力的关系
import { RecorderCore } from '../src/main/services/recorder-core.mjs'
import { ReplayCore } from '../src/main/services/replay-core.mjs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { statSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nativeModulePath = join(root, 'native', 'build', 'Release', 'screen-capture.node')
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const outDir = join(root, 'out')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const region = { x: 0, y: 0, width: 1280, height: 720 }
const replay = new ReplayCore({ nativeModulePath, ffmpegPath })
replay.start({ region, fps: 30, bitrateKbps: 4000, durationSec: 10, cacheDir: join(tmpdir(), 'sp-metrics-replay-720') })
await sleep(1200)
const rec = new RecorderCore({ nativeModulePath, ffmpegPath })
const t0 = Date.now()
rec.start({ region, fps: 30, bitrateKbps: 4000, outPath: join(outDir, 'metrics_rec_720.mp4') })
await sleep(10000)
const t1 = Date.now()
const stop = await rec.stop()
const wallSec = (t1 - t0) / 1000
const exp = await replay.export({ outPath: join(outDir, 'metrics_replay_720.mp4') })
await replay.stop()
console.log(JSON.stringify({
  region: '1280x720',
  wallSec: Math.round(wallSec * 100) / 100,
  framesWritten: stop.framesWritten,
  framesDropped: stop.framesDropped,
  actualFps: Math.round((stop.framesWritten / wallSec) * 10) / 10,
  dropRatePct: Math.round((stop.framesDropped / (stop.framesWritten + stop.framesDropped)) * 1000) / 10,
  videoDurationSec: Math.round((stop.durationSec ?? 0) * 100) / 100,
  recordSizeKB: Math.round(statSync(join(outDir, 'metrics_rec_720.mp4')).size / 1024),
  replayExport: { ok: exp.ok, segments: exp.segments, durationSec: exp.durationSec }
}, null, 2))
