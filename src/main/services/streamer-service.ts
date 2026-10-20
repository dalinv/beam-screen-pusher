// 光束录推 —— 推流服务（M3/M4，PRD F4）
// 封装 StreamerCore：路径、区域/分辨率设置、状态查询、IPC 入口
import { StreamerCore } from './streamer-core.mjs'
import { getFfmpegPath, getNativeModulePath } from './paths-service'
import { getSettings } from './settings-service'
import { getRegion } from './region-service'
import type { StreamStartParams, StreamStartResult, StreamState } from '../../shared/types'

let streamer: StreamerCore | null = null

function getStreamer(): StreamerCore {
  if (!streamer) {
    streamer = new StreamerCore({
      nativeModulePath: getNativeModulePath(),
      ffmpegPath: getFfmpegPath()
    })
  }
  return streamer
}

export function startStream(params: StreamStartParams): StreamStartResult {
  try {
    const s = getSettings()
    return getStreamer().start({
      region: getRegion(),
      fps: params.fps ?? s.record.fps,
      bitrateKbps: (params.bitrate ?? s.stream.bitrate) * 1000,
      scale: s.record.resolution,
      rtmpUrl: params.rtmpUrl,
      maxRetries: params.maxRetries ?? s.stream.maxRetries
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function stopStream(): Promise<{ ok: boolean; error?: string }> {
  try {
    return await getStreamer().stop()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function getStreamState(): StreamState {
  const s = getStreamer().getState()
  return { ...s, state: s.state === 'stopping' ? 'idle' : s.state }
}
