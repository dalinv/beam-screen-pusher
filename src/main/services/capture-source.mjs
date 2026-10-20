// 光束录推 —— 统一采集源（M3）
// 职责：管理 C++ 采集模块生命周期 + 定时取帧 + 把每帧分发给所有订阅者（录制/回看/推流）
// 说明：采集仍跑在主进程事件循环（BitBlt 同步）；TODO(M4) 独立采集线程
// 帧交付：CaptureNext 返回内部 Buffer（Copy），各订阅者独立持有，无覆盖风险
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export class CaptureSource {
  constructor({ nativeModulePath }) {
    this.nativeModulePath = nativeModulePath
    this.capture = null
    this.running = false
    this.timer = null
    this.info = null
    this.region = null
    this.fps = 30
    this.lastError = ''
    /** 实际帧率统计（最近 1s tick 数） */
    this.actualFps = 0
    this._fpsCount = 0
    this._fpsTimer = null
    /** @type {Set<(frame: Buffer) => void>} */
    this.subscribers = new Set()
  }

  /** 启动采集（幂等：参数一致时复用；参数变化则重建）。region: 'fullscreen' | {x,y,w,h} */
  start({ region, fps }) {
    if (this.running && this.region === region && this.fps === fps) return
    this._stopInternal()
    try {
      this.capture = require(this.nativeModulePath)
      this.capture.CaptureInit(region, fps)
      this.info = this.capture.GetInfo()
    } catch (e) {
      this.lastError = '采集初始化失败: ' + (e && e.message ? e.message : e)
      this.capture = null
      throw e
    }
    this.region = region
    this.fps = fps
    this.running = true
    this.timer = setInterval(() => this._tick(), 1000 / fps)
    this.actualFps = 0
    this._fpsCount = 0
    this._fpsTimer = setInterval(() => {
      this.actualFps = this._fpsCount
      this._fpsCount = 0
    }, 1000)
  }

  /** 采集性能（实际帧率/丢帧累计） */
  getPerf() {
    return { fps: this.actualFps, dropped: 0 }
  }

  /** 订阅帧（每帧一个内部 Buffer，可安全持有）；返回退订函数 */
  subscribe(fn) {
    this.subscribers.add(fn)
    return () => {
      this.subscribers.delete(fn)
    }
  }

  subscriberCount() {
    return this.subscribers.size
  }

  getInfo() {
    return this.info
  }

  /** 停止采集（清空订阅者） */
  stop() {
    this._stopInternal()
    this.subscribers.clear()
    if (this.capture) {
      try {
        this.capture.CaptureStop()
      } catch {
        /* 释放异常忽略 */
      }
      this.capture = null
    }
    this.info = null
  }

  _tick() {
    if (!this.running || !this.capture) return
    let frame
    try {
      frame = this.capture.CaptureNext()
      this._fpsCount++
    } catch (e) {
      this.lastError = '取帧失败: ' + (e && e.message ? e.message : e)
      return // 跳过该帧
    }
    // 同步分发：单个订阅者异常不影响其他消费者
    for (const fn of [...this.subscribers]) {
      try {
        fn(frame)
      } catch (e) {
        this.lastError = '帧分发异常: ' + (e && e.message ? e.message : e)
      }
    }
  }

  _stopInternal() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this._fpsTimer) {
      clearInterval(this._fpsTimer)
      this._fpsTimer = null
    }
    this.running = false
    this.region = null
  }
}

let singleton = null

/** 进程内唯一采集源（所有消费者共享同一路采集与原生模块实例） */
export function getCaptureSource(opts) {
  if (!singleton) singleton = new CaptureSource(opts)
  return singleton
}
