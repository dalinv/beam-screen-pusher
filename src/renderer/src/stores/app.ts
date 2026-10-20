import { defineStore } from 'pinia'
import type { CaptureRegion } from '@shared/types'

export type RecordUiState = 'idle' | 'recording' | 'paused'
export type StreamUiState = 'idle' | 'connecting' | 'streaming' | 'reconnecting'

/** 应用级状态（M1 骨架；按 架构设计 分域：recorder / replay / stream / settings） */
export const useAppStore = defineStore('app', {
  state: () => ({
    /** 应用版本（来自主进程） */
    version: '',
    /** 当前采集区域（region-service 同步） */
    region: 'fullscreen' as CaptureRegion,
    /** 预览源尺寸（物理像素） */
    previewW: 0,
    previewH: 0,
    /** 录制状态 */
    recordState: 'idle' as RecordUiState,
    /** 已录制秒数 */
    elapsedSec: 0,
    /** 最近一次输出文件路径（点击在文件管理器中显示） */
    lastOutput: '',
    /** 输出详情（时长/帧数等） */
    lastOutputMeta: '',
    /** 最近一次错误 */
    lastError: '',
    /** 回看：设置开启 */
    replayEnabled: false,
    /** 回看：缓冲运行中 */
    replayRunning: false,
    /** 回看：配置时长 */
    replayDurationSec: 10,
    /** 回看：缓冲分片数 */
    replaySegments: 0,
    /** 回看：toast 文本（自动消失） */
    replayToast: '',
    /** 推流状态 */
    streamState: 'idle' as StreamUiState,
    /** 已推流秒数 */
    streamElapsed: 0,
    /** 重连次数 */
    streamRetries: 0,
    /** 推流错误 */
    streamError: '',
    /** 性能面板：CPU 合计 % */
    cpuPercent: 0,
    /** 性能面板：内存合计 MB */
    memoryMB: 0,
    /** 性能面板：采集实际帧率 */
    captureFps: 0,
    /** 输出分辨率显示 */
    resolutionLabel: '原始'
  })
})
