export type ReplayRegion = 'fullscreen' | { x: number; y: number; width: number; height: number }

export interface ReplayStartParams {
  region: ReplayRegion
  fps?: number
  bitrateKbps?: number
  durationSec?: number
  scale?: 'original' | '1080p' | '720p'
  cacheDir: string
}

export interface ReplayStartResult {
  ok: boolean
  width?: number
  height?: number
  fps?: number
  durationSec?: number
  error?: string
}

export interface ReplayExportResult {
  ok: boolean
  path?: string
  durationSec?: number
  segments?: number
  frames?: number
  error?: string
}

export interface ReplayRuntimeState {
  running: boolean
  segments: number
  framesWritten: number
  framesDropped: number
  durationSec: number
  lastError: string
}

export declare class ReplayCore {
  constructor(options: { nativeModulePath: string; ffmpegPath: string })
  running: boolean
  start(params: ReplayStartParams): ReplayStartResult
  stop(): Promise<{ ok: boolean; error?: string }>
  export(params: { outPath: string }): Promise<ReplayExportResult>
  getState(): ReplayRuntimeState
}
