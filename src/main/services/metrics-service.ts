// 光束录推 —— 性能指标服务（M4，PRD F9 性能面板）
// CPU/内存来自 app.getAppMetrics（Electron 各进程统计），采集帧率来自统一采集源
import { app } from 'electron'
import { getCaptureSource } from './capture-source.mjs'
import { getNativeModulePath } from './paths-service'
import type { AppMetrics } from '../../shared/types'

export function getMetrics(): AppMetrics {
  const procs = app.getAppMetrics()
  const cpu = procs.reduce((s, p) => s + p.cpu.percentCPUUsage, 0)
  // workingSetSize 单位为 KB（Electron 44 实测），换算为 MB
  const mem = procs.reduce((s, p) => s + (p.memory?.workingSetSize ?? 0), 0) / 1024
  const perf = getCaptureSource({ nativeModulePath: getNativeModulePath() }).getPerf()
  return {
    cpuPercent: Math.round(cpu),
    memoryMB: Math.round(mem),
    captureFps: perf.fps,
    captureDropped: perf.dropped,
    processes: procs.map((p) => ({
      pid: p.pid,
      type: p.type,
      cpu: Math.round(p.cpu.percentCPUUsage),
      memory: Math.round((p.memory?.workingSetSize ?? 0) / 1024)
    }))
  }
}
