// 光束录推 —— 采集管理服务（架构设计 3.1 capture-manager）
// M1：加载原生模块 + 探测取帧（验证「Node 中能取到一帧并输出尺寸信息」）
// 平台适配：Windows GDI BitBlt（macOS CoreGraphics 后续接入）
import type { ProbeResult } from '../../shared/types'
import { getNativeModulePath } from './paths-service'

type CaptureModule = {
  CaptureInit(region: 'fullscreen' | { x: number; y: number; width: number; height: number }, fps: number): boolean
  CaptureNext(): Buffer
  CaptureStop(): void
  GetInfo(): { initialized: boolean; width: number; height: number; fps: number; x: number; y: number }
}

let captureMod: CaptureModule | null = null

/** 加载 C++ 采集原生模块（dev / 打包路径统一，见 paths-service） */
function loadCaptureModule(): CaptureModule {
  if (captureMod) return captureMod
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(getNativeModulePath()) as CaptureModule
  captureMod = mod
  return mod
}

/** 探测：初始化全屏采集 → 取一帧 → 停止，返回尺寸信息（供 UI 与验收使用） */
export function probeCapture(): ProbeResult {
  try {
    const mod = loadCaptureModule()
    mod.CaptureInit('fullscreen', 30)
    const info = mod.GetInfo()
    const frame = mod.CaptureNext()
    mod.CaptureStop()
    return {
      ok: frame.length === info.width * info.height * 4,
      width: info.width,
      height: info.height,
      fps: info.fps,
      bytes: frame.length
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
