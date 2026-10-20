export type StreamerState = 'idle' | 'connecting' | 'streaming' | 'reconnecting' | 'stopping'

export type StreamerRegion = 'fullscreen' | { x: number; y: number; width: number; height: number }

export interface StreamerStartParams {
  region: StreamerRegion
  fps: number
  bitrateKbps: number
  scale?: 'original' | '1080p' | '720p'
  rtmpUrl: string
  maxRetries?: number
}

export interface StreamerStartResult {
  ok: boolean
  rtmpUrl?: string
  error?: string
}

export interface StreamerStateInfo {
  state: StreamerState
  rtmpUrl: string
  retries: number
  framesWritten: number
  framesDropped: number
  lastError: string
}

export declare class StreamerCore {
  constructor(options: { nativeModulePath: string; ffmpegPath: string })
  state: StreamerState
  start(params: StreamerStartParams): StreamerStartResult
  stop(): Promise<{ ok: boolean; error?: string }>
  getState(): StreamerStateInfo
}
