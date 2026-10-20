// capture-source 单元测试 —— 幂等启动/订阅分发/异常隔离（假原生模块，不真实采集）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let CaptureSource

function fakeNative() {
  const calls = { init: 0, next: 0, stop: 0 }
  const api = {
    CaptureInit: () => {
      calls.init++
    },
    GetInfo: () => ({ width: 1920, height: 1080 }),
    CaptureNext: () => {
      calls.next++
      return Buffer.alloc(16)
    },
    CaptureStop: () => {
      calls.stop++
    }
  }
  return { api, calls }
}

beforeEach(async () => {
  vi.resetModules()
  const m = await import('../../src/main/services/capture-source.mjs')
  CaptureSource = m.CaptureSource
})
afterEach(() => {
  vi.useRealTimers()
})

describe('CaptureSource', () => {
  it('start 幂等：同参数不重复初始化/重建', () => {
    const { api, calls } = fakeNative()
    const cs = new CaptureSource({})
    cs._load = () => api // 手动注入
    // 直接模拟：通过替换 require 结果的方式验证幂等判断
    cs.capture = api
    cs.running = true
    cs.region = 'fullscreen'
    cs.fps = 30
    cs.start({ region: 'fullscreen', fps: 30 }) // 参数一致 → 直接 return
    expect(calls.init).toBe(0)
    expect(cs.running).toBe(true)
  })

  it('参数变化时触发重建路径（running/region 先被重置，再重新初始化）', () => {
    const { api } = fakeNative()
    const cs = new CaptureSource({})
    cs.capture = api
    cs.running = true
    cs.region = 'fullscreen'
    cs.fps = 30
    // 区域变化 → start 走 _stopInternal（重置运行状态）→ require 失败抛错（测试环境无真实 .node）
    expect(() => cs.start({ region: { x: 0, y: 0, width: 640, height: 360 }, fps: 30 })).toThrow()
    expect(cs.running).toBe(false) // 重建前状态已重置，不会残留旧采集
    expect(cs.region).toBe(null)
  })

  it('subscribe 返回退订函数，subscriberCount 正确', () => {
    const cs = new CaptureSource({})
    const fn1 = () => {}
    const fn2 = () => {}
    const un1 = cs.subscribe(fn1)
    cs.subscribe(fn2)
    expect(cs.subscriberCount()).toBe(2)
    un1()
    expect(cs.subscriberCount()).toBe(1)
  })

  it('_tick 分发：所有订阅者收到同一帧', () => {
    const { api } = fakeNative()
    const cs = new CaptureSource({})
    cs.capture = api
    cs.running = true
    const got = []
    cs.subscribe((f) => got.push(f.length))
    cs.subscribe((f) => got.push(f.length))
    cs._tick()
    expect(got).toEqual([16, 16])
  })

  it('单个订阅者抛错不影响其他消费者（异常隔离）', () => {
    const { api } = fakeNative()
    const cs = new CaptureSource({})
    cs.capture = api
    cs.running = true
    const got = []
    cs.subscribe(() => {
      throw new Error('consumer boom')
    })
    cs.subscribe((f) => got.push(f.length))
    cs._tick()
    expect(got).toEqual([16]) // 第二个订阅者仍收到帧
    expect(cs.lastError).toContain('帧分发异常')
  })

  it('取帧失败时跳过该帧并记录错误，不影响后续分发', () => {
    const cs = new CaptureSource({})
    cs.capture = {
      CaptureNext: () => {
        throw new Error('capture fail')
      }
    }
    cs.running = true
    const got = []
    cs.subscribe((f) => got.push(f))
    cs._tick()
    expect(got).toEqual([])
    expect(cs.lastError).toContain('取帧失败')
  })

  it('stop 清空订阅者并释放原生模块', () => {
    const { api, calls } = fakeNative()
    const cs = new CaptureSource({})
    cs.capture = api
    cs.subscribe(() => {})
    cs.stop()
    expect(calls.stop).toBe(1)
    expect(cs.subscriberCount()).toBe(0)
    expect(cs.capture).toBe(null)
    expect(cs.running).toBe(false)
  })
})
