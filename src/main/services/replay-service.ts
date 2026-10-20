// 光束录推 —— 回看服务（M3/M4，PRD 第 6 章）
// 职责：回看缓冲启停（应用启动时按设置自动开启）、标题栏按钮/快捷键 F9 导出、
//       导出成功系统通知（点击打开所在文件夹）、渲染层事件推送
import { app, globalShortcut, Notification, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { ReplayCore } from './replay-core.mjs'
import { getFfmpegPath, getNativeModulePath } from './paths-service'
import { ensureReplayDir, getSettings } from './settings-service'
import { getRegion } from './region-service'
import type { ReplayState, ReplaySaveResult } from '../../shared/types'

let replay: ReplayCore | null = null
let hotkeyRegistered = false

function getReplay(): ReplayCore {
  if (!replay) {
    replay = new ReplayCore({
      nativeModulePath: getNativeModulePath(),
      ffmpegPath: getFfmpegPath()
    })
  }
  return replay
}

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 按设置开启回看缓冲（应用启动时调用；设置里未开启则跳过） */
export function startReplayIfEnabled(): { ok: boolean; error?: string } {
  const s = getSettings().replay
  if (!s.enabled) return { ok: false, error: '回看未开启' }
  return startReplayBuffer()
}

/** 开启回看缓冲（强制模式：忽略 enabled，供自测/设置页预览） */
export function startReplayBuffer(): { ok: boolean; error?: string } {
  try {
    const s = getSettings()
    const r = getReplay().start({
      region: getRegion(),
      fps: s.replay.fps,
      bitrateKbps: s.replay.bitrate * 1000,
      durationSec: s.replay.durationSec,
      scale: s.record.resolution,
      cacheDir: join(app.getPath('temp'), 'beamscreenpusher-replay')
    })
    if (!r.ok) {
      console.error('[replay] startReplayBuffer 失败:', r.error)
      return { ok: false, error: r.error }
    }
    console.log('[replay] startReplayBuffer 成功:', JSON.stringify(r))
    registerReplayHotkey()
    return { ok: true }
  } catch (e) {
    console.error('[replay] startReplayBuffer 异常:', e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 关闭回看缓冲 */
export async function stopReplayBuffer(): Promise<{ ok: boolean; error?: string }> {
  try {
    unregisterReplayHotkey()
  } catch (e) {
    console.error('[replay] 注销快捷键异常:', e)
  }
  try {
    if (replay) {
      console.log('[replay] stopReplayBuffer 调用 replay.stop()')
      const r = await replay.stop()
      console.log('[replay] replay.stop() 返回:', JSON.stringify(r))
      return r
    }
    return { ok: true }
  } catch (e) {
    console.error('[replay] 停止缓冲异常:', e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 导出最近 N 秒（标题栏按钮 / 快捷键 F9 触发；成功后系统通知 + 推送渲染层） */
export async function saveReplay(): Promise<ReplaySaveResult> {
  if (!replay || !replay.running) {
    return { ok: false, error: '回看未开启' }
  }
  try {
    const name = `replay_${stamp()}.mp4`
    const outPath = join(ensureReplayDir(), name)
    const r = await replay.export({ outPath })
    if (r.ok) {
      showSavedNotification(name, r.durationSec ?? 0, outPath)
      broadcastSaved({ ok: true, path: outPath, name, durationSec: r.durationSec ?? 0 })
    }
    return { ok: r.ok, path: outPath, name, durationSec: r.durationSec ?? 0, error: r.error }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function getReplayState(): ReplayState {
  const s = getSettings()
  if (!replay || !replay.running) {
    return { enabled: s.replay.enabled, running: false, segments: 0, durationSec: s.replay.durationSec }
  }
  const st = replay.getState()
  return {
    enabled: s.replay.enabled,
    running: st.running,
    segments: st.segments,
    durationSec: s.replay.durationSec,
    framesWritten: st.framesWritten,
    framesDropped: st.framesDropped
  }
}

function registerReplayHotkey(): void {
  if (hotkeyRegistered) return
  const key = getSettings().replay.hotkey || 'F9'
  try {
    const ok = globalShortcut.register(key, () => {
      void saveReplay()
    })
    hotkeyRegistered = ok
    if (!ok) console.warn('[replay] 快捷键注册失败（可能被占用）:', key)
  } catch (e) {
    console.warn('[replay] 快捷键注册异常:', e)
  }
}

function unregisterReplayHotkey(): void {
  if (hotkeyRegistered) {
    globalShortcut.unregister(getSettings().replay.hotkey || 'F9')
    hotkeyRegistered = false
  }
}

function showSavedNotification(name: string, durationSec: number, outPath: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: '回看已保存',
    body: `${name}（${durationSec}s）· 点击打开所在文件夹`,
    silent: false
  })
  n.on('click', () => shell.showItemInFolder(outPath))
  n.show()
}

function broadcastSaved(result: ReplaySaveResult): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('replay:saved', result)
  }
}
