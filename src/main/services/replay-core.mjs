// 光束录推 —— 回看缓冲核心（M3，PRD 第 6 章）
// 链路：CaptureSource 分发帧 → ffmpeg H.264 segment 分片（TS，1s 一片，GOP 对齐）
//      → 环形保留最近 N 秒 → export() 时 concat 最近分片 remux 为 MP4（免重编码，秒级）
// 分片状态：segment muxer 写完一片才写入 index.txt（-segment_list），可安全导出
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getCaptureSource } from './capture-source.mjs'

const require = createRequire(import.meta.url)

export class ReplayCore {
  constructor({ nativeModulePath, ffmpegPath }) {
    this.nativeModulePath = nativeModulePath
    this.ffmpegPath = ffmpegPath
    this.running = false
    this.cacheDir = ''
    this.durationSec = 10
    this.ffmpeg = null
    this.stdinReady = false
    this.framesWritten = 0
    this.framesDropped = 0
    this.lastError = ''
    this._ffErrTail = ''
    this._unsub = null
    this._source = null
    this._cleanupTimer = null
  }

  /** 开启回看缓冲：启动统一采集源 + 缓冲 ffmpeg（segment 分片） */
  start({ region, fps = 30, bitrateKbps = 4000, durationSec = 10, cacheDir, scale = 'original' }) {
    if (this.running) throw new Error('回看已在运行')
    mkdirSync(cacheDir, { recursive: true })
    // 清理上次遗留分片
    for (const f of readdirSync(cacheDir)) {
      if (f.endsWith('.ts')) {
        try {
          unlinkSync(join(cacheDir, f))
        } catch {
          /* 忽略 */
        }
      }
    }
    try {
      writeFileSync(join(cacheDir, 'index.txt'), '')
    } catch {
      /* 忽略 */
    }

    const source = getCaptureSource({ nativeModulePath: this.nativeModulePath })
    source.start({ region, fps })
    const info = source.getInfo()
    const args = this._buildBufferArgs(info.width, info.height, fps, bitrateKbps, durationSec, cacheDir)
    const ff = spawn(this.ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
    ff.stderr.on('data', (d) => {
      this._ffErrTail = (this._ffErrTail + d.toString()).slice(-2000)
    })
    ff.on('error', (e) => {
      this.lastError = '回看 ffmpeg 启动失败: ' + e.message
    })
    ff.on('exit', (code) => {
      if (code !== 0) this.lastError = '回看 ffmpeg 退出码 ' + code + '：' + this._ffErrTail.trim().split('\n').slice(-3).join('\n')
    })

    this.running = true
    this.cacheDir = cacheDir
    this.durationSec = durationSec
    this.scale = scale
    this.ffmpeg = ff
    this.stdinReady = true
    this.framesWritten = 0
    this.framesDropped = 0
    this.lastError = ''
    this._source = source
    this._unsub = source.subscribe((frame) => this._onFrame(frame))
    // 分片清理轮询（1s）：超出窗口的最旧分片删除
    this._cleanupTimer = setInterval(() => this._cleanup(), 1000)
    return { ok: true, width: info.width, height: info.height, fps, durationSec }
  }

  /** 关闭回看缓冲（退订 → 结束 ffmpeg → 清缓存目录） */
  async stop() {
    if (!this.running) return { ok: true }
    this.running = false
    if (this._unsub) {
      this._unsub()
      this._unsub = null
    }
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer)
      this._cleanupTimer = null
    }
    if (this._source && this._source.subscriberCount() === 0) {
      this._source.stop()
    }
    this._source = null

    const ff = this.ffmpeg
    const code = await new Promise((resolve) => {
      const done = (c) => {
        ff.off('error', onErr)
        resolve(c)
      }
      const onErr = () => done(-1)
      ff.on('error', onErr)
      ff.once('exit', done)
      try {
        ff.stdin.end()
      } catch {
        done(-1)
      }
    })
    this.ffmpeg = null
    this._clearCache()
    if (code !== 0) return { ok: false, error: this.lastError || '回看 ffmpeg 退出码 ' + code }
    return { ok: true }
  }

  /** 导出最近 N 秒为 MP4（concat 已关闭分片 → remux，免重编码） */
  async export({ outPath }) {
    if (!this.running) return { ok: false, error: '回看未开启' }
    const list = this._segmentList()
    if (list.length === 0) return { ok: false, error: '缓冲为空，请稍后再试' }
    // 取最近 ceil(durationSec) 片（分片约 1s）
    const maxSegs = Math.max(1, Math.ceil(this.durationSec))
    const segs = list.slice(-maxSegs)
    const listFile = join(this.cacheDir, 'concat_list.txt')
    writeFileSync(listFile, segs.map((f) => `file '${this._segPath(f).replace(/'/g, "'\\''")}'`).join('\n') + '\n')

    const ff = this.ffmpegPath
    const outDir = outPath.slice(0, Math.max(outPath.lastIndexOf('\\'), outPath.lastIndexOf('/')))
    mkdirSync(outDir, { recursive: true })
    const r = spawnSync(
      ff,
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outPath],
      { encoding: 'utf8', windowsHide: true }
    )
    if (r.status !== 0) {
      return { ok: false, error: '导出失败: ' + (r.stderr || '').trim().split('\n').slice(-3).join('\n') }
    }
    return { ok: true, path: outPath, durationSec: segs.length, segments: segs.length, frames: this.framesWritten }
  }

  getState() {
    return {
      running: this.running,
      segments: this._segmentList().length,
      framesWritten: this.framesWritten,
      framesDropped: this.framesDropped,
      durationSec: this.durationSec,
      lastError: this.lastError
    }
  }

  _onFrame(frame) {
    if (!this.running) return
    if (!this.stdinReady || !this.ffmpeg || !this.ffmpeg.stdin.writable) {
      this.framesDropped++
      return
    }
    const ok = this.ffmpeg.stdin.write(frame)
    this.framesWritten++
    if (!ok) {
      this.stdinReady = false
      this.ffmpeg.stdin.once('drain', () => {
        this.stdinReady = true
      })
    }
  }

  /** 分片路径归一化：index 行可能是绝对路径（flat 类型行为随版本），也可能是相对文件名 */
  _segPath(f) {
    return f.includes('\\') || f.includes('/') ? f : join(this.cacheDir, f)
  }

  /** 已关闭分片列表（index.txt 行，按出现顺序） */
  _segmentList() {
    const idx = join(this.cacheDir, 'index.txt')
    if (!existsSync(idx)) return []
    try {
      return readFileSync(idx, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    } catch {
      return []
    }
  }

  /** 环形清理：保留最近 durationSec+2 片，删除更旧分片与索引行 */
  _cleanup() {
    if (!this.running) return
    const keep = Math.ceil(this.durationSec) + 2
    const list = this._segmentList()
    if (list.length <= keep) return
    const drop = list.length - keep
    const removed = new Set(list.slice(0, drop))
    for (const f of removed) {
      try {
        unlinkSync(this._segPath(f))
      } catch {
        /* 忽略 */
      }
    }
    writeFileSync(join(this.cacheDir, 'index.txt'), list.slice(drop).join('\n') + '\n')
  }

  _clearCache() {
    try {
      for (const f of readdirSync(this.cacheDir)) {
        if (f.endsWith('.ts') || f === 'index.txt' || f === 'concat_list.txt') {
          unlinkSync(join(this.cacheDir, f))
        }
      }
    } catch {
      /* 忽略 */
    }
  }

  _buildBufferArgs(w, h, fps, bitrateKbps, durationSec, cacheDir) {
    const targetH = this.scale === '1080p' ? 1080 : this.scale === '720p' ? 720 : 0
    const args = [
      '-y',
      '-f', 'rawvideo',
      '-pix_fmt', 'bgra',
      '-s', `${w}x${h}`,
      '-r', String(fps),
      '-i', '-'
    ]
    if (targetH > 0 && h > targetH) {
      args.push('-vf', `scale=-2:${targetH}`)
    }
    args.push(
      '-an',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-b:v', `${bitrateKbps}k`,
      '-maxrate', `${bitrateKbps}k`,
      '-bufsize', `${bitrateKbps * 2}k`,
      '-g', String(fps), // GOP = 1s，与分片对齐（每片独立解码）
      '-pix_fmt', 'yuv420p',
      '-f', 'segment',
      '-segment_time', '1',
      '-segment_format', 'mpegts',
      '-reset_timestamps', '1',
      '-segment_list', join(cacheDir, 'index.txt'),
      '-segment_list_type', 'flat',
      join(cacheDir, 'replay_%05d.ts')
    )
    return args
  }
}
