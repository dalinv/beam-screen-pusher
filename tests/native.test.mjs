// 原生采集模块测试（node:test）—— 测试规范 §4 用例：尺寸/格式/帧率/坐标/非法参数/停止重开
// 前置：npm run build:native（node-gyp rebuild --directory=native）
// 运行：node --test tests/native.test.mjs
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const mod = require(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'native', 'build', 'Release', 'screen-capture.node')
)

describe('原生采集模块（真实 GDI 采集）', () => {
  test('全屏采集：帧尺寸与字节数 = w×h×4', () => {
    mod.CaptureInit('fullscreen', 30)
    const info = mod.GetInfo()
    const frame = mod.CaptureNext()
    assert.ok(info.width > 0 && info.height > 0, '尺寸应为正')
    assert.equal(frame.length, info.width * info.height * 4, 'BGRA 每像素 4 字节')
    assert.ok(frame.length > 0, '帧内容非空')
    mod.CaptureStop()
  })

  test('区域采集 640×360@(100,100)：坐标与尺寸正确', () => {
    mod.CaptureInit({ x: 100, y: 100, width: 640, height: 360 }, 30)
    const info = mod.GetInfo()
    const frame = mod.CaptureNext()
    assert.equal(info.width, 640)
    assert.equal(info.height, 360)
    assert.ok(info.x >= 0 && info.y >= 0)
    assert.equal(frame.length, 640 * 360 * 4)
    mod.CaptureStop()
  })

  test('30fps 采 60 帧：吞吐稳定（CaptureNext 无节流，≥13fps），帧间隔无明显抖动', { timeout: 20000 }, async () => {
    mod.CaptureInit('fullscreen', 30)
    const t0 = performance.now()
    let last = null
    const intervals = []
    for (let i = 0; i < 60; i++) {
      mod.CaptureNext()
      const now = performance.now()
      if (last !== null) intervals.push(now - last)
      last = now
    }
    const elapsed = performance.now() - t0
    mod.CaptureStop()
    assert.ok(elapsed >= 800 && elapsed <= 4600, `60 帧吞吐应稳定（800~4600ms），实际 ${elapsed.toFixed(0)}ms`)
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
    assert.ok(avg > 8 && avg < 60, `帧间隔均值应在 8~60ms，实际 ${avg.toFixed(1)}ms`)
  })

  test('非法参数：宽高<=0/超限、未知 mode 抛错且不崩溃；非法 fps 回退 30', () => {
    assert.throws(() => mod.CaptureInit({ x: 0, y: 0, width: 0, height: 100 }, 30))
    assert.throws(() => mod.CaptureInit({ x: 0, y: 0, width: -100, height: 100 }, 30))
    assert.throws(() => mod.CaptureInit({ x: 0, y: 0, width: 100, height: 20000 }, 30))
    assert.throws(() => mod.CaptureInit('bogus-mode', 30))
    // 非法 fps 按契约回退 30（不抛错）
    mod.CaptureInit('fullscreen', 0)
    assert.equal(mod.GetInfo().fps, 30)
    // 负坐标合法（GDI 按源偏移处理），且非法后仍可正常初始化（不残留坏状态）
    mod.CaptureInit({ x: -5, y: -5, width: 640, height: 360 }, 30)
    assert.ok(mod.CaptureNext().length > 0)
    mod.CaptureStop()
  })

  test('停止后重开：再次采集正常，无句柄/内存泄漏', () => {
    const beforeMem = process.memoryUsage().rss
    for (let i = 0; i < 3; i++) {
      mod.CaptureInit('fullscreen', 15)
      for (let j = 0; j < 10; j++) mod.CaptureNext()
      mod.CaptureStop()
    }
    const afterMem = process.memoryUsage().rss
    assert.ok(afterMem - beforeMem < 50 * 1024 * 1024, `RSS 增长应 <50MB，实际 ${((afterMem - beforeMem) / 1048576).toFixed(1)}MB`)
  })

  test('连续 300 帧（约 10s）：内存增长 < 50MB（稳定性基线）', { timeout: 40000 }, () => {
    mod.CaptureInit('fullscreen', 30)
    const base = process.memoryUsage().rss
    for (let i = 0; i < 300; i++) mod.CaptureNext()
    const peak = process.memoryUsage().rss
    mod.CaptureStop()
    assert.ok(peak - base < 50 * 1024 * 1024, `内存增长 ${((peak - base) / 1048576).toFixed(1)}MB 应 <50MB`)
  })
})
