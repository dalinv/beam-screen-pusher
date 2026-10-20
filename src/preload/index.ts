// 光束录推 —— 预加载桥（架构设计 3.3：window.spAPI 白名单，渲染层不接触 Node）
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
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

const spAPI = {
  /** 应用版本 */
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.AppGetVersion),
  /** 采集探测（M1 验证） */
  probeCapture: (): Promise<ProbeResult> => ipcRenderer.invoke(IPC.CaptureProbe),
  /** 开始录制 */
  startRecord: (params: RecordStartParams): Promise<RecordStartResult> => ipcRenderer.invoke(IPC.RecorderStart, params),
  /** 停止录制 */
  stopRecord: (): Promise<RecordStopResult> => ipcRenderer.invoke(IPC.RecorderStop),
  /** 暂停录制 */
  pauseRecord: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.RecorderPause),
  /** 恢复录制 */
  resumeRecord: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.RecorderResume),
  /** 查询录制状态 */
  getRecorderState: (): Promise<RecorderState> => ipcRenderer.invoke(IPC.RecorderGetState),
  /** 回看：导出最近 N 秒（标题栏按钮 / 快捷键） */
  saveReplay: (): Promise<ReplaySaveResult> => ipcRenderer.invoke(IPC.ReplaySave),
  /** 回看：查询状态 */
  getReplayState: (): Promise<ReplayState> => ipcRenderer.invoke(IPC.ReplayGetState),
  /** 回看：导出成功事件（快捷键触发时渲染层提示） */
  onReplaySaved: (cb: (r: ReplaySaveResult) => void): (() => void) => {
    const listener = (_e: unknown, r: ReplaySaveResult): void => cb(r)
    ipcRenderer.on(IPC.ReplaySavedEvent, listener)
    return () => ipcRenderer.removeListener(IPC.ReplaySavedEvent, listener)
  },
  /** 开始推流 */
  startStream: (params: StreamStartParams): Promise<StreamStartResult> => ipcRenderer.invoke(IPC.StreamStart, params),
  /** 停止推流 */
  stopStream: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.StreamStop),
  /** 查询推流状态 */
  getStreamState: (): Promise<StreamState> => ipcRenderer.invoke(IPC.StreamGetState),
  /** 打开设置窗口 */
  openSettings: (): Promise<void> => ipcRenderer.invoke(IPC.OpenSettings),
  /** 在文件管理器中显示文件（点击保存路径跳转） */
  revealPath: (path: string): Promise<void> => ipcRenderer.invoke(IPC.AppRevealPath, path),
  /** 读取设置 */
  getSettings: (): Promise<SettingsDto> => ipcRenderer.invoke(IPC.SettingsGet),
  /** 保存设置 */
  setSettings: (patch: Partial<SettingsDto>): Promise<SettingsDto> => ipcRenderer.invoke(IPC.SettingsSet, patch),
  /** 性能指标 */
  getMetrics: (): Promise<AppMetrics> => ipcRenderer.invoke(IPC.AppMetrics),
  /** 预览：获取屏幕捕获源 */
  getPreviewSource: (): Promise<{ id: string; name: string; width: number; height: number } | null> =>
    ipcRenderer.invoke(IPC.PreviewGetSource),
  /** 打开区域选择窗口 */
  openRegionSelect: (): Promise<void> => ipcRenderer.invoke(IPC.RegionOpen),
  /** 确认区域（窗口内逻辑坐标，主进程换算物理像素） */
  confirmRegion: (rect: { x: number; y: number; width: number; height: number }): Promise<CaptureRegion> =>
    ipcRenderer.invoke(IPC.RegionConfirm, rect),
  /** 取消区域选择 */
  cancelRegion: (): Promise<void> => ipcRenderer.invoke(IPC.RegionCancel),
  /** 查询当前采集区域 */
  getRegionState: (): Promise<CaptureRegion> => ipcRenderer.invoke(IPC.RegionGetState),
  /** 区域变更事件（主窗口刷新采集范围显示） */
  onRegionChanged: (cb: (region: CaptureRegion) => void): (() => void) => {
    const listener = (_e: unknown, region: CaptureRegion): void => cb(region)
    ipcRenderer.on(IPC.RegionChangedEvent, listener)
    return () => ipcRenderer.removeListener(IPC.RegionChangedEvent, listener)
  },
  /** 区域延迟生效提示（录制/推流进行中，停止后生效） */
  onRegionDeferred: (cb: (message: string) => void): (() => void) => {
    const listener = (_e: unknown, message: string): void => cb(message)
    ipcRenderer.on(IPC.RegionDeferredEvent, listener)
    return () => ipcRenderer.removeListener(IPC.RegionDeferredEvent, listener)
  }
}

contextBridge.exposeInMainWorld('spAPI', spAPI)

export type SpAPI = typeof spAPI
