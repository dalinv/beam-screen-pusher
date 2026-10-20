// 光束录推 —— Electron 主进程环境冒烟
// 目的：复现「Electron 窗口内录制 0 帧」问题。
// 在真实 Electron ABI 下验证：原生模块加载 → 全屏取帧 → recorder-core 短录 3 秒
// 运行：node_modules\.bin\electron.cmd scripts\electron-record-smoke.mjs
import { app } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { RecorderCore } from '../src/main/services/recorder-core.mjs'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const native = join(root, 'native', 'build', 'Release', 'screen-capture.node')

app.whenReady().then(async () => {
  try {
    // 1) 原生模块直测（Electron ABI）
    const cap = require(native)
    cap.CaptureInit('fullscreen', 30)
    console.log('[1] GetInfo:', JSON.stringify(cap.GetInfo()))
    const f = cap.CaptureNext()
    console.log('[1] CaptureNext bytes:', f.length)
    cap.CaptureStop()
    console.log('[1] 原生模块 OK')

    // 2) recorder-core 短录 3 秒（全屏）
    const rec = new RecorderCore({ nativeModulePath: native, ffmpegPath })
    const out = join(root, 'out', 'electron-record-smoke.mp4')
    mkdirSync(join(root, 'out'), { recursive: true })
    const r = rec.start({ region: 'fullscreen', fps: 30, bitrateKbps: 4000, outPath: out })
    console.log('[2] start:', JSON.stringify(r))
    await new Promise((res) => setTimeout(res, 3000))
    const s = await rec.stop()
    console.log('[2] stop:', JSON.stringify(s))
    const size = statSync(out).size
    console.log('[2] file size:', size, 'bytes', size > 100000 ? '（正常）' : '（异常：过小）')
    console.log('RESULT:', s.ok && size > 100000 ? 'PASS' : 'FAIL')
  } catch (e) {
    console.error('RESULT: FAIL -', e && e.stack ? e.stack : e)
  }
  app.exit(0)
})
