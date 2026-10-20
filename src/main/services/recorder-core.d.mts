export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopping'

export interface RecorderRegion {
  x: number
  y: number
  width: number
  height: number
}

export type RecorderRegionInput = 'fullscreen' | RecorderRegion

export interface RecorderStartParams {
  region: RecorderRegionInput
  fps: number
  bitrateKbps: number
  scale?: 'original' | '1080p' | '720p'
  outPath: string
}

export interface RecorderStartResult {
  ok: boolean
  width?: number
  height?: number
  fps?: number
  outPath?: string
  error?: string
}

export interface RecorderStopResult {
  ok: boolean
  path?: string
  durationSec?: number
  framesWritten?: number
  framesDropped?: number
  error?: string
}

export interface RecorderCoreOptions {
  nativeModulePath: string
  ffmpegPath: string
}

export declare class RecorderCore {
  constructor(options: RecorderCoreOptions)
  state: RecorderState
  /** 已写入帧数（state 非 idle 时有效） */
  framesWritten: number
  /** 目标帧率 */
  fps: number
  start(params: RecorderStartParams): RecorderStartResult
  pause(): void
  resume(): void
  stop(): Promise<RecorderStopResult>
}
