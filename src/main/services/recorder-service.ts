// 光束录推 —— 录制服务（架构设计 3.1 recorder-service）
// 封装 RecorderCore：加载原生模块与 ffmpeg、输出目录与命名、区域/分辨率设置、录制通知
import { Notification } from 'electron'
import { join } from 'node:path'
import { RecorderCore } from './recorder-core.mjs'
import { getFfmpegPath, getNativeModulePath } from './paths-service'
import { ensureRecordDir, getSettings } from './settings-service'
import { getRegion } from './region-service'
import type { RecordStartParams, RecordStartResult, RecordStopResult, RecorderState } from '../../shared/types'

let recorder: RecorderCore | null = null

function getRecorder(): RecorderCore {
  if (!recorder) {
    recorder = new RecorderCore({
      nativeModulePath: getNativeModulePath(),
      ffmpegPath: getFfmpegPath()
    })
  }
  return recorder
}

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function startRecord(params: RecordStartParams): RecordStartResult {
  try {
    const s = getSettings()
    const result = getRecorder().start({
      region: getRegion(),
      fps: params.fps ?? s.record.fps,
      bitrateKbps: (params.bitrate ?? s.record.bitrate) * 1000,
      scale: s.record.resolution,
      outPath: join(ensureRecordDir(), `screen_${stamp()}.mp4`)
    })
    if (result.ok && Notification.isSupported()) {
      new Notification({ title: '录制开始', body: `${result.width}x${result.height} @${result.fps}fps` }).show()
    }
    return result
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function stopRecord(): Promise<RecordStopResult> {
  try {
    const result = await getRecorder().stop()
    if (result.ok && Notification.isSupported()) {
      new Notification({
        title: '录制已保存',
        body: `${result.path ?? ''}\n时长 ${(result.durationSec ?? 0).toFixed(1)}s，写入 ${result.framesWritten ?? 0} 帧`
      }).show()
    }
    return result
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function pauseRecord(): { ok: boolean; error?: string } {
  try {
    getRecorder().pause()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function resumeRecord(): { ok: boolean; error?: string } {
  try {
    getRecorder().resume()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function getRecorderState(): RecorderState {
  const rec = getRecorder()
  const state = rec.state === 'stopping' ? 'idle' : rec.state
  return { state, elapsedSec: state === 'idle' ? 0 : Math.round((rec.framesWritten / rec.fps) * 10) / 10 }
}
