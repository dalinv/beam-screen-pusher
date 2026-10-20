import type {
  AppMetrics,
  CaptureRegion,
  ProbeResult,
  RecordStartParams,
  RecordStartResult,
  RecordStopResult,
  RecorderState,
  ReplaySaveResult,
  ReplayState,
  SettingsDto,
  StreamStartParams,
  StreamStartResult,
  StreamState
} from '../shared/types'

declare global {
  interface Window {
    /** 主进程通过 contextBridge 暴露的白名单 API（架构设计 3.3） */
    spAPI: {
      getVersion(): Promise<string>
      probeCapture(): Promise<ProbeResult>
      startRecord(params: RecordStartParams): Promise<RecordStartResult>
      stopRecord(): Promise<RecordStopResult>
      pauseRecord(): Promise<{ ok: boolean; error?: string }>
      resumeRecord(): Promise<{ ok: boolean; error?: string }>
      getRecorderState(): Promise<RecorderState>
      saveReplay(): Promise<ReplaySaveResult>
      getReplayState(): Promise<ReplayState>
      onReplaySaved(cb: (r: ReplaySaveResult) => void): () => void
      startStream(params: StreamStartParams): Promise<StreamStartResult>
      stopStream(): Promise<{ ok: boolean; error?: string }>
      getStreamState(): Promise<StreamState>
      openSettings(): Promise<void>
      revealPath(path: string): Promise<void>
      getSettings(): Promise<SettingsDto>
      setSettings(patch: Partial<SettingsDto>): Promise<SettingsDto>
      getMetrics(): Promise<AppMetrics>
      getPreviewSource(): Promise<{ id: string; name: string; width: number; height: number } | null>
      openRegionSelect(): Promise<void>
      confirmRegion(rect: { x: number; y: number; width: number; height: number }): Promise<CaptureRegion>
      cancelRegion(): Promise<void>
      getRegionState(): Promise<CaptureRegion>
      onRegionChanged(cb: (region: CaptureRegion) => void): () => void
      onRegionDeferred(cb: (message: string) => void): () => void
    }
  }
}

export {}
