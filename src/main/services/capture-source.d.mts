// capture-source.mjs 类型声明（统一采集源）
export type CaptureRegion = 'fullscreen' | { x: number; y: number; width: number; height: number }

export interface CaptureSourceInfo {
  initialized: boolean
  width: number
  height: number
  fps: number
  x: number
  y: number
}

export declare class CaptureSource {
  constructor(options: { nativeModulePath: string })
  running: boolean
  start(options: { region: CaptureRegion; fps: number }): { ok: boolean; error?: string }
  stop(): void
  getInfo(): CaptureSourceInfo | null
  subscribe(fn: (frame: Buffer) => void): () => void
  getPerf(): { fps: number; dropped: number }
}

export declare function getCaptureSource(options: { nativeModulePath: string }): CaptureSource
