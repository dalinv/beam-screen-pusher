// 光束录推 —— IPC payload 与状态类型（架构设计 3.2）

/** 采集探测结果（M1） */
export interface ProbeResult {
  ok: boolean
  width?: number
  height?: number
  fps?: number
  /** 帧字节数（期望 width*height*4） */
  bytes?: number
  error?: string
}

/** 采集区域：全屏（虚拟屏幕）或自定义矩形 */
export type CaptureRegion = 'fullscreen' | { x: number; y: number; width: number; height: number }

/** 开始录制参数（recorder:start） */
export interface RecordStartParams {
  region: CaptureRegion
  fps: number
  /** Mbps */
  bitrate: number
}

/** 开始录制结果 */
export interface RecordStartResult {
  ok: boolean
  width?: number
  height?: number
  fps?: number
  outPath?: string
  error?: string
}

/** 停止录制结果 */
export interface RecordStopResult {
  ok: boolean
  path?: string
  durationSec?: number
  framesWritten?: number
  framesDropped?: number
  error?: string
}

/** 录制状态（recorder:get-state） */
export interface RecorderState {
  state: 'idle' | 'recording' | 'paused'
  elapsedSec: number
}

/** 回看状态（replay:get-state） */
export interface ReplayState {
  enabled: boolean
  running: boolean
  segments: number
  durationSec: number
  framesWritten?: number
  framesDropped?: number
}

/** 回看导出结果（replay:save / replay:saved 事件） */
export interface ReplaySaveResult {
  ok: boolean
  path?: string
  name?: string
  durationSec?: number
  error?: string
}

/** 开始推流参数（stream:start） */
export interface StreamStartParams {
  region: CaptureRegion
  fps: number
  /** Mbps */
  bitrate: number
  /** RTMP 地址（含推流码） */
  rtmpUrl: string
  /** 自动重连次数（默认 3） */
  maxRetries?: number
}

export interface StreamStartResult {
  ok: boolean
  rtmpUrl?: string
  error?: string
}

/** 推流状态（stream:get-state） */
export interface StreamState {
  state: 'idle' | 'connecting' | 'streaming' | 'reconnecting'
  rtmpUrl: string
  retries: number
  framesWritten: number
  framesDropped: number
  lastError: string
}

/** 输出分辨率选项 */
export type ResolutionOption = 'original' | '1080p' | '720p'

/** 设置（settings:get / settings:set，渲染层视图） */
export interface SettingsDto {
  replay: {
    enabled: boolean
    durationSec: number
    hotkey: string
    dir: string
    fps: number
    bitrate: number
  }
  record: {
    fps: number
    bitrate: number
    resolution: ResolutionOption
    outDir: string
  }
  stream: {
    bitrate: number
    maxRetries: number
  }
}

/** 性能指标（app:metrics） */
export interface AppMetrics {
  /** 全部进程 CPU 占用合计（%） */
  cpuPercent: number
  /** 全部进程内存合计（MB） */
  memoryMB: number
  /** 采集实际帧率 */
  captureFps: number
  /** 采集丢帧累计（最近一次循环） */
  captureDropped: number
  processes: { pid: number; type: string; cpu: number; memory: number }[]
}

