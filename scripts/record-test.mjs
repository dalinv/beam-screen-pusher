// 光束录推 —— M2 录制链路验证脚本
// 用法：node scripts/record-test.mjs [秒数] [--fullscreen] [--pause]
//   默认 1920x1080 区域录 5 秒 → 用 ffmpeg 解码校验可播放性
//   --pause   录制中演示一次暂停/恢复（暂停段不计入时长）
import { RecorderCore } from '../src/main/services/recorder-core.mjs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const nativeModulePath = join(root, 'native', 'build', 'Release', 'screen-capture.node')
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const outDir = join(root, 'out', 'test-recordings')
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, `record_${Date.now()}.mp4`)

const seconds = Math.max(1, Number(process.argv[2] || 5))
const useFullscreen = process.argv.includes('--fullscreen')
const usePause = process.argv.includes('--pause')
const region = useFullscreen ? 'fullscreen' : { x: 0, y: 0, width: 1920, height: 1080 }

console.log('原生模块 :', nativeModulePath)
console.log('ffmpeg   :', ffmpegPath)
console.log('区域     :', typeof region === 'string' ? region : JSON.stringify(region))
console.log('时长     :', seconds, 's @ 30fps / 4Mbps', usePause ? '（含暂停演示）' : '')

const rec = new RecorderCore({ nativeModulePath, ffmpegPath })

const start = rec.start({ region, fps: 30, bitrateKbps: 4000, outPath })
console.log('启动     :', start.ok ? `${start.width}x${start.height} -> ${start.outPath}` : JSON.stringify(start))
if (!start.ok) process.exit(1)

const t0 = Date.now()
if (usePause) {
  await new Promise((r) => setTimeout(r, (seconds / 3) * 1000))
  rec.pause()
  console.log('暂停     : 已暂停')
  await new Promise((r) => setTimeout(r, 1000))
  rec.resume()
  console.log('恢复     : 已恢复')
  await new Promise((r) => setTimeout(r, ((seconds * 2) / 3) * 1000))
} else {
  await new Promise((r) => setTimeout(r, seconds * 1000))
}
const wallSec = (Date.now() - t0) / 1000

const stop = await rec.stop()
console.log('停止     :', JSON.stringify(stop, null, 2))
if (!stop.ok) process.exit(1)

// 实际帧率：活跃录制时间内写入帧数 / 实际活跃时间（暂停段不算）
const activeSec = wallSec - (usePause ? 1 : 0)
const actualFps = ((stop.framesWritten ?? 0) / Math.max(activeSec, 0.1)).toFixed(1)

// 解码验证：ffmpeg -v error -i out.mp4 -f null - 无错误即视为可播放
const check = spawnSync(ffmpegPath, ['-v', 'error', '-i', outPath, '-f', 'null', '-'], {
  encoding: 'utf8',
  windowsHide: true
})
const sizeMB = (statSync(outPath).size / 1024 / 1024).toFixed(2)
console.log('文件     :', outPath, `(${sizeMB} MB)`)
console.log('解码验证 :', check.status === 0 ? 'PASS（可正常解码播放）' : `FAIL\n${check.stderr}`)
console.log('帧统计   : 写入', stop.framesWritten, '帧，丢帧', stop.framesDropped, '，实际帧率', actualFps, 'fps，录制时长', stop.durationSec?.toFixed(1), 's')
process.exit(check.status === 0 ? 0 : 1)
