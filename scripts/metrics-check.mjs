// 光束录推 —— 功能指标采集（录制/回看/性能），供功能测试报告引用
// 真实 GDI 采集 + ffmpeg，全屏 2560x1440 @30fps
// 用法：node scripts/metrics-check.mjs
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

const out = {}

// 1) 回看缓冲（12s 缓冲，10s 窗口）
const replay = new ReplayCore({ nativeModulePath, ffmpegPath })
const cacheDir = join(tmpdir(), 'sp-metrics-replay')
replay.start({ region: 'fullscreen', fps: 30, bitrateKbps: 4000, durationSec: 10, cacheDir })
await sleep(1200)
out.replay = replay.getState()

// 2) 录制 10s（与回看共享同一路采集源）
const rec = new RecorderCore({ nativeModulePath, ffmpegPath })
const recPath = join(outDir, 'metrics_rec.mp4')
const t0 = Date.now()
rec.start({ region: 'fullscreen', fps: 30, bitrateKbps: 4000, outPath: recPath })
await sleep(10000)
const t1 = Date.now()
const stop = await rec.stop()
const wallSec = (t1 - t0) / 1000
out.record = {
  wallSec: Math.round(wallSec * 100) / 100,
  framesWritten: stop.framesWritten,
  framesDropped: stop.framesDropped,
  actualFps: Math.round((stop.framesWritten / wallSec) * 10) / 10,
  dropRatePct: Math.round((stop.framesDropped / (stop.framesWritten + stop.framesDropped)) * 1000) / 10,
  durationSec: Math.round((stop.durationSec ?? 0) * 100) / 100,
  sizeKB: Math.round(statSync(recPath).size / 1024)
}

// 3) 回看导出（10s）——测耗时
const expPath = join(outDir, 'metrics_replay.mp4')
const t2 = Date.now()
const exp = await replay.export({ outPath: expPath })
const t3 = Date.now()
out.replay.exportMs = t3 - t2
out.replay.export = { ok: exp.ok, segments: exp.segments, durationSec: exp.durationSec }
if (exp.ok) out.replay.export.sizeKB = Math.round(statSync(expPath).size / 1024)

await replay.stop()
console.log(JSON.stringify(out, null, 2))
