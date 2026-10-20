// 光束录推 —— M3 回看链路验证脚本
// 用法：node scripts/replay-test.mjs [缓冲秒数] [--fullscreen]
//   默认 1280x720 缓冲 12 秒（配置 10s）→ 导出 → ffmpeg 校验时长与可播放性
import { ReplayCore } from '../src/main/services/replay-core.mjs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, statSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const nativeModulePath = join(root, 'native', 'build', 'Release', 'screen-capture.node')
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const outDir = join(root, 'out', 'test-replays')
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, `replay_${Date.now()}.mp4`)

const buffSec = Math.max(3, Number(process.argv[2] || 12))
const durationSec = Math.min(buffSec - 2, 10)
const region = process.argv.includes('--fullscreen') ? 'fullscreen' : { x: 0, y: 0, width: 1280, height: 720 }
const cacheDir = join(root, 'out', 'replay-cache')

console.log('区域     :', typeof region === 'string' ? region : JSON.stringify(region))
console.log(`缓冲 ${buffSec}s（配置时长 ${durationSec}s）@30fps / 4Mbps`)

const replay = new ReplayCore({ nativeModulePath, ffmpegPath })
const start = replay.start({ region, fps: 30, bitrateKbps: 4000, durationSec, cacheDir })
console.log('开启回看 :', start.ok ? `${start.width}x${start.height}` : JSON.stringify(start))
if (!start.ok) process.exit(1)

await new Promise((r) => setTimeout(r, buffSec * 1000))
console.log('缓冲中   :', JSON.stringify(replay.getState()))

const exp = await replay.export({ outPath })
console.log('导出     :', JSON.stringify(exp, null, 2))
if (!exp.ok) process.exit(1)

// 校验：ffmpeg 读取时长 + 解码
const probe = spawnSync(ffmpegPath, ['-i', outPath], { encoding: 'utf8', windowsHide: true })
const durMatch = (probe.stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/) || [])
const durSec = durMatch.length === 4 ? Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3]) : -1
const check = spawnSync(ffmpegPath, ['-v', 'error', '-i', outPath, '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true })
const sizeMB = (statSync(outPath).size / 1024 / 1024).toFixed(2)
console.log('文件     :', outPath, `(${sizeMB} MB)`)
console.log('实测时长 :', durSec.toFixed(2), 's（期望 ≈', durationSec, '±1.5s）')
console.log('解码验证 :', check.status === 0 ? 'PASS' : `FAIL\n${check.stderr}`)
const ok = check.status === 0 && Math.abs(durSec - durationSec) <= 1.5
console.log('RESULT   :', ok ? 'PASS' : 'FAIL')
console.log('分片残留 :', readdirSync(cacheDir).filter((f) => f.endsWith('.ts')).length, '（stop 后应清空）')
await replay.stop()
console.log('分片清理 :', readdirSync(cacheDir).filter((f) => f.endsWith('.ts')).length, '片')
process.exit(ok ? 0 : 1)
