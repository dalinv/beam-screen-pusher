// 光束录推 —— M3 推流链路验证脚本（PRD F4）
// 流程：本地 node-media-server（RTMP 1935）收流 → StreamerCore 推流 8s（720p）
//      → ffmpeg 拉流解码验证 → 停止推流 → 关闭服务
// 用法：node scripts/stream-test.mjs
import { StreamerCore } from '../src/main/services/streamer-core.mjs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nativeModulePath = join(root, 'native', 'build', 'Release', 'screen-capture.node')
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path

const NodeMediaServer = (await import('node-media-server')).default
const rtmpUrl = 'rtmp://127.0.0.1:1935/live/test'

// 1) 启动本地 RTMP 服务
const nms = new NodeMediaServer({
  rtmp: { port: 1935, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 }
})
let received = false
nms.on('postPublish', (id, streamPath) => {
  received = true
  console.log('[NMS] 收到推流:', streamPath)
})
nms.run()
console.log('[NMS] RTMP 服务已启动 :1935')
await new Promise((r) => setTimeout(r, 800))

// 2) 开始推流
const streamer = new StreamerCore({ nativeModulePath, ffmpegPath })
const start = streamer.start({ region: { x: 0, y: 0, width: 1280, height: 720 }, fps: 30, bitrateKbps: 4000, rtmpUrl })
console.log('[推流] start:', JSON.stringify(start))
if (!start.ok) process.exit(1)

// 3) 拉流解码验证（6 秒窗口）
let pullOk = false
const pull = spawn(ffmpegPath, ['-f', 'flv', '-i', rtmpUrl, '-t', '6', '-f', 'null', '-'], { windowsHide: true })
pull.on('exit', (code) => {
  pullOk = code === 0
  console.log('[拉流] ffmpeg 退出码:', code, code === 0 ? '（可正常拉流解码）' : '')
})

// 4) 推流 8 秒后停止
await new Promise((r) => setTimeout(r, 8000))
const stop = await streamer.stop()
console.log('[推流] stop:', JSON.stringify(stop))

// 5) 收尾：等拉流进程结束，关闭服务
await new Promise((r) => setTimeout(r, 1500))
nms.stop()
console.log('----')
console.log('服务收流  :', received ? 'PASS（本地 RTMP 服务收到流）' : 'FAIL（未收到推流）')
console.log('拉流解码  :', pullOk ? 'PASS' : 'FAIL')
const ok = received && stop.ok && (stop.framesWritten ?? 0) > 100 && pullOk
console.log('帧统计    : 写入', stop.framesWritten, '帧，丢帧', stop.framesDropped)
console.log('RESULT    :', ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
