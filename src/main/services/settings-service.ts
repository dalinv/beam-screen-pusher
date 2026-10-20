// 光束录推 —— 设置服务（M4：设置页读写；userData/settings.json 持久化）
import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

export type ResolutionOption = 'original' | '1080p' | '720p'

export interface ReplaySettings {
  enabled: boolean
  durationSec: number
  hotkey: string
  dir: string
  fps: number
  bitrate: number
}

export interface RecordSettings {
  fps: number
  bitrate: number
  /** 输出分辨率（ffmpeg scale） */
  resolution: ResolutionOption
  outDir: string
}

export interface StreamSettings {
  bitrate: number
  maxRetries: number
}

export interface Settings {
  replay: ReplaySettings
  record: RecordSettings
  stream: StreamSettings
}

const DEFAULTS: Settings = {
  replay: {
    enabled: false, // PRD 6.4：默认关闭
    durationSec: 10,
    hotkey: 'F9',
    dir: '',
    fps: 30,
    bitrate: 4
  },
  record: { fps: 30, bitrate: 4, resolution: 'original', outDir: '' },
  stream: { bitrate: 4, maxRetries: 3 }
}

let cache: Settings | null = null

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function defaultReplayDir(): string {
  return process.platform === 'darwin' ? join(app.getPath('home'), 'Movies', 'Replay') : 'D:\\Videos\\Replay'
}

function defaultRecordDir(): string {
  return process.platform === 'darwin' ? join(app.getPath('home'), 'Movies') : 'D:\\Videos'
}

export function getSettings(): Settings {
  if (cache) return cache
  const base: Settings = JSON.parse(JSON.stringify(DEFAULTS))
  base.replay.dir = defaultReplayDir()
  base.record.outDir = defaultRecordDir()
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf8'))
    if (raw.replay) base.replay = { ...base.replay, ...raw.replay }
    if (raw.record) base.record = { ...base.record, ...raw.record }
    if (raw.stream) base.stream = { ...base.stream, ...raw.stream }
  } catch {
    /* 无配置文件时用默认值 */
  }
  cache = base
  return base
}

/** 保存（返回最新设置；不修改调用方持有的旧引用，便于调用方 diff 前后变化） */
export function setSettings(patch: Partial<Settings>): Settings {
  const cur = getSettings()
  const next: Settings = {
    replay: patch.replay ? { ...cur.replay, ...patch.replay } : { ...cur.replay },
    record: patch.record ? { ...cur.record, ...patch.record } : { ...cur.record },
    stream: patch.stream ? { ...cur.stream, ...patch.stream } : { ...cur.stream }
  }
  cache = next
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8')
  } catch (e) {
    console.error('[settings] 写入失败:', e)
  }
  return next
}

/** 确保回看保存目录存在并返回 */
export function ensureReplayDir(): string {
  const dir = getSettings().replay.dir
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* 目录创建失败时降级 */
  }
  return dir
}

/** 确保录制输出目录存在并返回 */
export function ensureRecordDir(): string {
  const dir = getSettings().record.outDir
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* 目录创建失败时降级 */
  }
  return dir
}
