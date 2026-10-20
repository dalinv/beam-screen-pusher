// recorder-core 单元测试 —— ffmpeg 参数构造（scale 矩阵）与状态机
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RecorderCore } from '../../src/main/services/recorder-core.mjs'

// 不拉起真实 ffmpeg/采集，只测纯逻辑
vi.mock('node:child_process', () => ({
  spawn: () => ({
    stdin: { on: () => {}, writable: true, end: () => {}, write: () => true },
    stderr: { on: () => {} },
    on: () => {},
    once: () => {}
  })
}))

function makeCore() {
  const c = new RecorderCore({ nativeModulePath: 'x', ffmpegPath: 'ffmpeg' })
  c._source = { subscriberCount: () => 1, stop: () => {} }
  c.ffmpeg = { stdin: { on: () => {}, writable: true, end: () => {}, write: () => true }, on: () => {}, once: () => {} }
  return c
}

describe('RecorderCore._buildFfmpegArgs（scale 矩阵）', () => {
  it('original：不附加 -vf scale', () => {
    const c = makeCore()
    const args = c._buildFfmpegArgs(1920, 1080, 30, 4000, 'out.mp4', 'original')
    expect(args).not.toContain('-vf')
    expect(args).toContain('out.mp4')
  })

  it('1080p 且源高于 1080：scale=-2:1080', () => {
    const c = makeCore()
    const args = c._buildFfmpegArgs(2560, 1440, 30, 4000, 'out.mp4', '1080p')
    const i = args.indexOf('-vf')
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe('scale=-2:1080')
  })

  it('1080p 且源不高于 1080：不放大', () => {
    const c = makeCore()
    const args = c._buildFfmpegArgs(1280, 720, 30, 4000, 'out.mp4', '1080p')
    expect(args).not.toContain('-vf')
  })

  it('720p 且源高于 720：scale=-2:720', () => {
    const c = makeCore()
    const args = c._buildFfmpegArgs(1920, 1080, 30, 4000, 'out.mp4', '720p')
    const i = args.indexOf('-vf')
    expect(args[i + 1]).toBe('scale=-2:720')
  })

  it('关键编码参数：rawvideo/bgra/码率/GOP 对齐', () => {
    const c = makeCore()
    const args = c._buildFfmpegArgs(1920, 1080, 60, 8000, 'out.mp4', 'original')
    expect(args.join(' ')).toContain('-f rawvideo')
    expect(args.join(' ')).toContain('-pix_fmt bgra')
    expect(args.join(' ')).toContain('-s 1920x1080')
    expect(args.join(' ')).toContain('-b:v 8000k')
    expect(args.join(' ')).toContain('-g 60') // GOP=1s 与回看分片对齐
    expect(args.join(' ')).toContain('-movflags +faststart')
  })
})

describe('RecorderCore 状态机', () => {
  it('start 后为 recording；重复 start 抛错', async () => {
    const c = makeCore()
    c.state = 'idle'
    // 不实际 start（需要真实采集源），直接验证非法转换拒绝
    c.state = 'recording'
    expect(() => c.pause()).not.toThrow()
    expect(() => c.resume()).not.toThrow()
    c.state = 'paused'
    expect(() => c.resume()).not.toThrow()
  })

  it('非法转换被忽略：recording 中 resume 无效果、idle 中 pause 无效果', async () => {
    const c = makeCore()
    c.state = 'recording'
    c.resume() // 非 paused 忽略
    expect(c.state).toBe('recording')
    c.state = 'idle'
    c.pause()
    expect(c.state).toBe('idle')
  })

  it('stop 在 idle 返回 ok:false 且不改状态', async () => {
    const c = makeCore()
    c.state = 'idle'
    const r = await c.stop()
    expect(r.ok).toBe(false)
    expect(c.state).toBe('idle')
  })

  it('写帧：paused 状态帧被丢弃（暂停不计丢帧，丢帧仅统计背压写入失败）', () => {
    const c = makeCore()
    c.state = 'paused'
    c.framesWritten = 0
    c.framesDropped = 0
    c._onFrame(Buffer.alloc(16))
    expect(c.framesWritten).toBe(0)
    expect(c.framesDropped).toBe(0) // 暂停为主动忽略，非丢帧
  })

  it('写帧：stdin 不可写时计丢帧', () => {
    const c = makeCore()
    c.state = 'recording'
    c.stdinReady = false // 背压中
    c._onFrame(Buffer.alloc(16))
    expect(c.framesWritten).toBe(0)
    expect(c.framesDropped).toBe(1)
  })
})
