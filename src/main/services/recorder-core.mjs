// 光束录推 —— 录制消费者（M3 重构：不再自持采集循环，订阅统一采集源）
// 链路：CaptureSource 分发帧 → 本模块写入 ffmpeg stdin → libx264 编码 MP4
// 状态机：idle → recording ⇄ paused → stopping → idle
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { getCaptureSource } from './capture-source.mjs'

const require = createRequire(import.meta.url)

export class RecorderCore {
  constructor({ nativeModulePath, ffmpegPath }) {
    this.nativeModulePath = nativeModulePath
    this.ffmpegPath = ffmpegPath
    this.state = 'idle' // idle | recording | paused | stopping
    this.fps = 30
    this.bitrateKbps = 4000
    this.outPath = ''
    this.ffmpeg = null
    this.stdinReady = false
    this.framesWritten = 0
    this.framesDropped = 0
    this.lastError = ''
    this._ffErrTail = ''
    this._unsub = null
    this._source = null
  }

  /** 启动录制：启动统一采集源 → 拉起 ffmpeg → 订阅帧（同步返回，成功后由采集源驱动） */
  start({ region, fps, bitrateKbps, outPath, scale = 'original' }) {
    if (this.state !== 'idle') throw new Error('已在录制中（state=' + this.state + '）')

    const source = getCaptureSource({ nativeModulePath: this.nativeModulePath })
    source.start({ region, fps })
    const info = source.getInfo()
    const args = this._buildFfmpegArgs(info.width, info.height, fps, bitrateKbps, outPath, scale)
    const ff = spawn(this.ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
    ff.stderr.on('data', (d) => {
      this._ffErrTail = (this._ffErrTail + d.toString()).slice(-2000)
    })
    ff.on('error', (e) => {
      this.lastError = 'ffmpeg 启动失败: ' + e.message
    })
    ff.on('exit', (code) => {
      if (code !== 0) this.lastError = 'ffmpeg 退出码 ' + code + '：' + this._ffErrTail.trim().split('\n').slice(-3).join('\n')
    })

    this.ffmpeg = ff
    this.fps = fps
    this.bitrateKbps = bitrateKbps
    this.outPath = outPath
    this.stdinReady = true
    this.framesWritten = 0
    this.framesDropped = 0
    this.lastError = ''
    this.state = 'recording'
    this._source = source
    this._unsub = source.subscribe((frame) => this._onFrame(frame))
    return { ok: true, width: info.width, height: info.height, fps, outPath }
  }

  /** 暂停：忽略后续帧（时间线不含暂停段） */
  pause() {
    if (this.state !== 'recording') return
    this.state = 'paused'
  }

  /** 恢复 */
  resume() {
    if (this.state !== 'paused') return
    this.state = 'recording'
  }

  /** 停止：退订 → 结束输入 → 等待 ffmpeg 收尾 → 返回结果 */
  async stop() {
    if (this.state === 'idle') return { ok: false, error: '未在录制' }
    this.state = 'stopping'
    if (this._unsub) {
      this._unsub()
      this._unsub = null
    }
    // 采集源无其他消费者时停止采集
    if (this._source && this._source.subscriberCount() === 0) {
      this._source.stop()
    }
    this._source = null

    const ff = this.ffmpeg
    const frames = this.framesWritten
    const durationSec = frames / this.fps
    const path = this.outPath
    const code = await new Promise((resolve) => {
      // ffmpeg 若已提前退出（如编码参数错误启动即崩），exitCode 已就绪，直接返回避免永久挂起
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
    this.state = 'idle'
    this.ffmpeg = null
    if (code !== 0) {
      return {
        ok: false,
        error: this.lastError || 'ffmpeg 退出码 ' + code,
        framesWritten: frames,
        framesDropped: this.framesDropped
      }
    }
    return { ok: true, path, durationSec, framesWritten: frames, framesDropped: this.framesDropped }
  }

  _onFrame(frame) {
    if (this.state !== 'recording') return
    this._writeFrame(frame)
  }

  _writeFrame(frame) {
    // 帧为内部 Buffer（CaptureNext 走 Buffer::Copy），可安全持有；仅需关注背压
    if (!this.stdinReady || !this.ffmpeg || !this.ffmpeg.stdin.writable) {
      this.framesDropped++
      return
    }
    const ok = this.ffmpeg.stdin.write(frame)
    this.framesWritten++
    if (!ok) {
      // 背压：暂停写入直到 drain，超出的帧计为丢帧，避免内存堆积
      this.stdinReady = false
      this.ffmpeg.stdin.once('drain', () => {
        this.stdinReady = true
      })
    }
  }

  _buildFfmpegArgs(w, h, fps, bitrateKbps, outPath, scale) {
    const targetH = scale === '1080p' ? 1080 : scale === '720p' ? 720 : 0
    const args = [
      '-y',
      '-f', 'rawvideo',
      '-pix_fmt', 'bgra',
      '-s', `${w}x${h}`,
      '-r', String(fps),
      '-i', '-'
    ]
    // 输出分辨率缩放（仅当采集高度高于目标时；保持宽高比、宽度取偶数）
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
      '-g', String(fps), // GOP = 1s（与回看分片对齐复用，见 PRD 6.5）
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outPath
    )
    return args
  }
}
