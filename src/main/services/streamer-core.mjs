// 光束录推 —— 推流核心（M3，PRD F4）
// 链路：CaptureSource 分发帧 → ffmpeg libx264 → RTMP（flv）
// 状态机：idle → connecting → streaming ⇄ reconnecting → idle
// 断线重连：ffmpeg 非零退出（网络中断等）→ 最多 3 次退避重试（2/4/8s）
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { getCaptureSource } from './capture-source.mjs'

const require = createRequire(import.meta.url)

export class StreamerCore {
  constructor({ nativeModulePath, ffmpegPath }) {
    this.nativeModulePath = nativeModulePath
    this.ffmpegPath = ffmpegPath
    this.state = 'idle' // idle | connecting | streaming | reconnecting | stopping
    this.fps = 30
    this.bitrateKbps = 4000
    this.rtmpUrl = ''
    this.ffmpeg = null
    this.stdinReady = false
    this.framesWritten = 0
    this.framesDropped = 0
    this.lastError = ''
    this._ffErrTail = ''
    this._unsub = null
    this._source = null
    this._retries = 0
    this._maxRetries = 3
    this._reconnectTimer = null
    this._stopping = false
  }

  /** 开始推流 */
  start({ region, fps, bitrateKbps, rtmpUrl, maxRetries = 3, scale = 'original' }) {
    if (this.state !== 'idle') throw new Error('已在推流中（state=' + this.state + '）')
    this.rtmpUrl = rtmpUrl
    this.fps = fps
    this.bitrateKbps = bitrateKbps
    this._maxRetries = maxRetries
    this._retries = 0
    this._stopping = false
    this.scale = scale

    const source = getCaptureSource({ nativeModulePath: this.nativeModulePath })
    source.start({ region, fps })
    this._source = source
    this._unsub = source.subscribe((frame) => this._onFrame(frame))
    this._spawnFfmpeg()
    return { ok: true, rtmpUrl }
  }

  /** 停止推流（取消重连） */
  async stop() {
    if (this.state === 'idle') return { ok: false, error: '未在推流' }
    this._stopping = true
    this.state = 'stopping'
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
    if (this._unsub) {
      this._unsub()
      this._unsub = null
    }
    if (this._source && this._source.subscriberCount() === 0) {
      this._source.stop()
    }
    this._source = null
    const code = await this._closeFfmpeg()
    this.state = 'idle'
    this.ffmpeg = null
    if (code !== 0 && !this._stopping) {
      return { ok: false, error: this.lastError || 'ffmpeg 退出码 ' + code }
    }
    return { ok: true, framesWritten: this.framesWritten, framesDropped: this.framesDropped }
  }

  getState() {
    return {
      state: this.state === 'stopping' ? 'idle' : this.state,
      rtmpUrl: this.rtmpUrl,
      retries: this._retries,
      framesWritten: this.framesWritten,
      framesDropped: this.framesDropped,
      lastError: this.lastError
    }
  }

  _spawnFfmpeg() {
    if (this._stopping) return
    this.state = 'connecting'
    const info = this._source.getInfo()
    const args = this._buildArgs(info.width, info.height, this.fps, this.bitrateKbps, this.rtmpUrl)
    const ff = spawn(this.ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
    ff.stderr.on('data', (d) => {
      this._ffErrTail = (this._ffErrTail + d.toString()).slice(-3000)
    })
    ff.on('error', (e) => {
      this.lastError = 'ffmpeg 启动失败: ' + e.message
      this._handleExit(-1)
    })
    ff.on('exit', (code) => {
      this._handleExit(code ?? -1)
    })
    // 短暂连接期后进入 streaming（ffmpeg 输出首帧即连上）
    setTimeout(() => {
      if (this.ffmpeg === ff && this.state === 'connecting') this.state = 'streaming'
    }, 1200)
    this.ffmpeg = ff
    this.stdinReady = true
  }

  _handleExit(code) {
    if (this._stopping) return
    const wasStreaming = this.state === 'streaming' || this.state === 'connecting'
    this._closeFfmpeg() // 清理引用（不 await）
    if (wasStreaming && code !== 0 && this._retries < this._maxRetries) {
      this._retries++
      this.state = 'reconnecting'
      const delay = Math.pow(2, this._retries) * 1000 // 2/4/8s 退避
      this.lastError = '推流中断（第 ' + this._retries + ' 次），' + delay / 1000 + 's 后重连'
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null
        if (!this._stopping) this._spawnFfmpeg()
      }, delay)
    } else {
      this.state = 'idle'
      if (code !== 0) this.lastError = '推流失败: ' + (this.lastError || 'ffmpeg 退出码 ' + code)
    }
  }

  _closeFfmpeg() {
    const ff = this.ffmpeg
    if (!ff) return Promise.resolve(-1)
    this.ffmpeg = null
    return new Promise((resolve) => {
      // ffmpeg 已提前退出（如编码参数错误启动即崩）时 exitCode 已就绪，直接返回避免永久挂起
      if (ff.exitCode !== null) {
        resolve(ff.exitCode)
        return
      }
      const timer = setTimeout(() => {
        ff.removeListener('exit', onExit)
        resolve(ff.exitCode ?? -1) // 超时保护：ffmpeg 收尾卡死时不再阻塞 UI
      }, 5000)
      const onExit = (c) => {
        clearTimeout(timer)
        resolve(c)
      }
      ff.once('exit', onExit)
      ff.on('error', () => {
        clearTimeout(timer)
        resolve(-1)
      })
      try {
        ff.stdin.end()
      } catch {
        clearTimeout(timer)
        resolve(-1)
      }
    })
  }

  _onFrame(frame) {
    if (this.state !== 'streaming' && this.state !== 'connecting') return
    this._writeFrame(frame)
  }

  _writeFrame(frame) {
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

  _buildArgs(w, h, fps, bitrateKbps, rtmpUrl) {
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
      '-g', String(fps),
      '-pix_fmt', 'yuv420p',
      '-f', 'flv',
      rtmpUrl
    )
    return args
  }
}
