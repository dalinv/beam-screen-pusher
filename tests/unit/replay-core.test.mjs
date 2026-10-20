// replay-core 单元测试 —— 环形缓冲/分片列表/清理/导出选段（纯逻辑，不跑真实 ffmpeg）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

// 模拟 spawnSync：仅导出流程用，返回成功，便于断言 concat_list 选段
const spawnSyncMock = vi.fn(() => ({ status: 0, stderr: '' }))
vi.mock('node:child_process', () => ({
  spawn: () => ({
    stdin: { on: () => {}, writable: true, end: () => {}, write: () => true },
    stderr: { on: () => {} },
    on: () => {},
    once: () => {}
  }),
  spawnSync: (...a) => spawnSyncMock(...a)
}))

let ReplayCore
let cacheDir

beforeEach(() => {
  vi.resetModules()
  cacheDir = fs.mkdtempSync(join(os.tmpdir(), 'replay-test-'))
  return import('../../src/main/services/replay-core.mjs').then((m) => {
    ReplayCore = m.ReplayCore
  })
})
afterEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true })
})

function makeCore(overrides = {}) {
  const c = new ReplayCore({ nativeModulePath: 'x', ffmpegPath: 'ffmpeg' })
  Object.assign(c, { running: true, cacheDir, durationSec: 10, ...overrides })
  return c
}

function writeIndex(lines) {
  fs.writeFileSync(join(cacheDir, 'index.txt'), lines.join('\n') + '\n', 'utf8')
}

describe('ReplayCore._buildBufferArgs（segment 缓冲参数）', () => {
  it('segment 分片 1s / GOP 对齐 / index 输出', () => {
    const c = makeCore({ scale: 'original' })
    const args = c._buildBufferArgs(1920, 1080, 30, 4000, 10, cacheDir)
    const s = args.join(' ')
    expect(s).toContain('-f segment')
    expect(s).toContain('-segment_time 1')
    expect(s).toContain('-segment_list_type flat')
    expect(s).toContain('-g 30')
    expect(s).toContain(join(cacheDir, 'index.txt'))
  })

  it('缓冲 scale：1080p 源高于目标才缩放', () => {
    const c = makeCore({ scale: '1080p' })
    const args = c._buildBufferArgs(2560, 1440, 30, 4000, 10, cacheDir)
    expect(args.join(' ')).toContain('scale=-2:1080')
    const c2 = makeCore({ scale: '1080p' })
    const args2 = c2._buildBufferArgs(1280, 720, 30, 4000, 10, cacheDir)
    expect(args2).not.toContain('-vf')
  })
})

describe('ReplayCore 分片列表与路径', () => {
  it('_segmentList 解析 index.txt（忽略空行）', () => {
    writeIndex(['seg1.ts', '', 'seg2.ts'])
    const c = makeCore()
    expect(c._segmentList()).toEqual(['seg1.ts', 'seg2.ts'])
  })

  it('_segPath：相对名拼缓存目录，绝对路径原样返回', () => {
    const c = makeCore()
    expect(c._segPath('a.ts')).toBe(join(cacheDir, 'a.ts'))
    expect(c._segPath('C:\\tmp\\a.ts')).toBe('C:\\tmp\\a.ts')
    expect(c._segPath('/tmp/a.ts')).toBe('/tmp/a.ts')
  })
})

describe('ReplayCore._cleanup（环形淘汰）', () => {
  it('超过 durationSec+2 片时删除最旧并收缩 index', () => {
    const segs = Array.from({ length: 15 }, (_, i) => `r_${String(i).padStart(5, '0')}.ts`)
    for (const f of segs) fs.writeFileSync(join(cacheDir, f), 'x')
    writeIndex(segs)
    const c = makeCore({ durationSec: 10 }) // keep = 12
    c._cleanup()
    const list = c._segmentList()
    expect(list.length).toBe(12)
    expect(list[0]).toBe('r_00003.ts') // 最旧 3 片被淘汰
    expect(fs.existsSync(join(cacheDir, 'r_00000.ts'))).toBe(false)
    expect(fs.existsSync(join(cacheDir, 'r_00003.ts'))).toBe(true)
  })

  it('未超窗口不清理', () => {
    const segs = ['a.ts', 'b.ts']
    writeIndex(segs)
    fs.writeFileSync(join(cacheDir, 'a.ts'), 'x')
    fs.writeFileSync(join(cacheDir, 'b.ts'), 'x')
    const c = makeCore({ durationSec: 10 })
    c._cleanup()
    expect(c._segmentList()).toEqual(['a.ts', 'b.ts'])
  })

  it('未运行时清理直接返回', () => {
    writeIndex(['a.ts'])
    const c = makeCore({ running: false })
    c._cleanup()
    expect(c._segmentList()).toEqual(['a.ts'])
  })
})

describe('ReplayCore.export（导出最近 N 秒选段）', () => {
  it('取最近 ceil(durationSec) 片写入 concat_list（免重编码 remux）', async () => {
    const segs = Array.from({ length: 12 }, (_, i) => `r_${String(i).padStart(5, '0')}.ts`)
    for (const f of segs) fs.writeFileSync(join(cacheDir, f), 'x')
    writeIndex(segs)
    const c = makeCore({ durationSec: 10 }) // maxSegs = 10
    const r = await c.export({ outPath: join(cacheDir, 'out', 'replay.mp4') })
    expect(r.ok).toBe(true)
    expect(r.segments).toBe(10)
    const listFile = fs.readFileSync(join(cacheDir, 'concat_list.txt'), 'utf8')
    expect(listFile.split('\n').filter(Boolean).length).toBe(10)
    expect(listFile).toContain('r_00002.ts') // 最旧 2 片不在导出范围
    expect(listFile).not.toContain('r_00001.ts')
  })

  it('缓冲为空时导出失败且提示', async () => {
    const c = makeCore()
    const r = await c.export({ outPath: join(cacheDir, 'out', 'replay.mp4') })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('缓冲为空')
  })

  it('未运行时导出拒绝', async () => {
    const c = makeCore({ running: false })
    const r = await c.export({ outPath: 'x.mp4' })
    expect(r.ok).toBe(false)
  })
})
