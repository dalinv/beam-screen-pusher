// 设置服务单元测试 —— 重点：M4 修复的「setSettings 不可变更新」回归
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const tmpUserData = vi.hoisted(() => 'C:\\tmp-test\\BeamScreenPusher-unit')

vi.mock('electron', () => ({
  app: {
    getPath: (name) => (name === 'userData' ? tmpUserData : name === 'home' ? 'C:\\Users\\tester' : '')
  }
}))

// 每次测试重载模块以重置 cache
async function freshModule() {
  vi.resetModules()
  return await import('../../src/main/services/settings-service.ts')
}

describe('settings-service', () => {
  let fs
  beforeEach(async () => {
    fs = await import('node:fs')
    fs.rmSync(tmpUserData, { recursive: true, force: true })
    fs.mkdirSync(tmpUserData, { recursive: true })
  })
  afterEach(() => {
    vi.resetModules()
  })

  it('getSettings 无配置文件时返回默认值（目录按平台填充）', async () => {
    const m = await freshModule()
    const s = m.getSettings()
    expect(s.replay.enabled).toBe(false) // PRD 6.4 默认关闭
    expect(s.replay.durationSec).toBe(10)
    expect(s.replay.hotkey).toBe('F9')
    expect(s.replay.dir).toBeTruthy()
    expect(s.record.resolution).toBe('original')
    expect(s.stream.maxRetries).toBe(3)
  })

  it('setSettings 返回新对象且不修改调用方旧引用（diff 前提）', async () => {
    const m = await freshModule()
    const cur = m.getSettings()
    const next = m.setSettings({ replay: { enabled: true } })
    // 引用不同：调用方持有的 cur 不受影响 → 可 diff 前后变化
    expect(next).not.toBe(cur)
    expect(cur.replay.enabled).toBe(false)
    expect(next.replay.enabled).toBe(true)
    // 未 patch 的部分共享原值
    expect(next.record).toEqual(cur.record)
  })

  it('合并语义：深合并到分组，不整组覆盖', async () => {
    const m = await freshModule()
    const next = m.setSettings({ replay: { enabled: true } })
    expect(next.replay.durationSec).toBe(10) // 仅覆盖 enabled，其余保留
    const next2 = m.setSettings({ record: { resolution: '1080p' } })
    expect(next2.replay.enabled).toBe(true) // 前一次写入仍保留
    expect(next2.record.fps).toBe(30)
    expect(next2.record.resolution).toBe('1080p')
  })

  it('持久化回读：写入文件后重新加载得到相同设置', async () => {
    const m = await freshModule()
    m.setSettings({ replay: { enabled: true, durationSec: 20 }, record: { resolution: '720p' } })
    const raw = JSON.parse(fs.readFileSync(tmpUserData + '\\settings.json', 'utf8'))
    expect(raw.replay.enabled).toBe(true)
    expect(raw.replay.durationSec).toBe(20)
    expect(raw.record.resolution).toBe('720p')
    // 新模块实例重新读取（cache 清空）
    const m2 = await freshModule()
    const loaded = m2.getSettings()
    expect(loaded.replay.enabled).toBe(true)
    expect(loaded.record.resolution).toBe('720p')
  })

  it('损坏的配置文件回退默认值且不抛错', async () => {
    fs.writeFileSync(tmpUserData + '\\settings.json', '{ not valid json', 'utf8')
    const m = await freshModule()
    const s = m.getSettings()
    expect(s.replay.enabled).toBe(false)
    expect(s.record.fps).toBe(30)
  })
})
