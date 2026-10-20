// 光束录推 —— 主进程入口（架构设计 2：单实例；服务单例；UI 事件不被采集/编码阻塞）
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc-channels'
import { probeCapture } from './services/capture-manager'
import { getRecorderState, pauseRecord, resumeRecord, startRecord, stopRecord } from './services/recorder-service'
import { getReplayState, saveReplay, startReplayBuffer, startReplayIfEnabled, stopReplayBuffer } from './services/replay-service'
import { getStreamState, startStream, stopStream } from './services/streamer-service'
import { getSettings, setSettings } from './services/settings-service'
import { getMetrics } from './services/metrics-service'
import { getPreviewSource, allowPreviewPermissions } from './services/preview-service'
import { getRegion } from './services/region-service'
import { confirmRegion, closeRegionWindow, openRegionWindow } from './windows/region-window'
import { createTray, updateTrayRecording } from './tray-service'
import { openSettingsWindow } from './windows/settings-window'
import type { CaptureRegion, RecordStartParams, SettingsDto, StreamStartParams } from '../shared/types'

// 测试/CI 隔离：SCREENPUSHER_USERDATA 覆盖 userData（必须在 app ready 前）
if (process.env.SCREENPUSHER_USERDATA) {
  app.setPath('userData', process.env.SCREENPUSHER_USERDATA)
}

// 单实例锁：重复启动时聚焦已有窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  let isQuiting = false

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  function createWindow(): void {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 640,
      title: '光束录推 BeamScreenPusher',
      backgroundColor: '#14171c',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    mainWindow.on('ready-to-show', () => mainWindow?.show())

    // 关闭按钮 → 最小化到托盘（M4，PRD F6）；真正退出走托盘「退出」/ before-quit
    mainWindow.on('close', (e) => {
      if (!isQuiting) {
        e.preventDefault()
        mainWindow?.hide()
      }
    })
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    // 开发模式加载 dev server（Vite HMR）；生产加载构建产物
    if (process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  // 区域确认后应用新区域到活动管线：
  // - 仅回看缓冲运行：重建（独立管线，安全；新区域立即生效）
  // - 录制/推流运行：采集源帧尺寸变更会破坏 ffmpeg rawvideo 输入，延迟到停止后生效（向主窗口推送提示）
  async function applyRegionToActivePipelines(): Promise<void> {
    const recording = getRecorderState().state === 'recording'
    const streaming = getStreamState().state === 'streaming'
    if (recording || streaming) {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send(IPC.RegionDeferredEvent, '录制/推流进行中，新采集区域将在停止后生效')
      }
      return
    }
    if (getReplayState().running) {
      await stopReplayBuffer()
      startReplayBuffer()
    }
  }

  // IPC 白名单注册（架构设计 3.3）
  function registerIpc(): void {    ipcMain.handle(IPC.AppGetVersion, () => app.getVersion())
    ipcMain.handle(IPC.CaptureProbe, () => probeCapture())
    ipcMain.handle(IPC.RecorderStart, (_e, params: RecordStartParams) => {
      const r = startRecord(params)
      if (r.ok) updateTrayRecording(true)
      return r
    })
    ipcMain.handle(IPC.RecorderStop, async () => {
      const r = await stopRecord()
      if (r.ok) updateTrayRecording(false)
      return r
    })
    ipcMain.handle(IPC.RecorderPause, () => pauseRecord())
    ipcMain.handle(IPC.RecorderResume, () => resumeRecord())
    ipcMain.handle(IPC.RecorderGetState, () => getRecorderState())
    ipcMain.handle(IPC.ReplaySave, () => saveReplay())
    ipcMain.handle(IPC.ReplayGetState, () => getReplayState())
    ipcMain.handle(IPC.StreamStart, (_e, params: StreamStartParams) => startStream(params))
    ipcMain.handle(IPC.StreamStop, () => stopStream())
    ipcMain.handle(IPC.StreamGetState, () => getStreamState())
    ipcMain.handle(IPC.OpenSettings, () => openSettingsWindow())
    ipcMain.handle(IPC.SettingsGet, () => getSettings())
    ipcMain.handle(IPC.SettingsSet, (_e, patch: Partial<SettingsDto>) => {
      // 回看参数实时生效：启用状态变化 → 启停缓冲；缓冲中改时长/帧率/码率 → 重建
      const before = getSettings()
      const after = setSettings(patch)
      const changed =
        before.replay.enabled !== after.replay.enabled ||
        (after.replay.enabled &&
          (before.replay.durationSec !== after.replay.durationSec ||
            before.replay.fps !== after.replay.fps ||
            before.replay.bitrate !== after.replay.bitrate))
      if (changed) {
        if (after.replay.enabled) {
          void stopReplayBuffer().then(() => startReplayBuffer())
        } else {
          void stopReplayBuffer()
        }
      }
      return after
    })
    ipcMain.handle(IPC.AppMetrics, () => getMetrics())
    ipcMain.handle(IPC.PreviewGetSource, () => getPreviewSource())
    ipcMain.handle(IPC.RegionOpen, () => openRegionWindow())
    ipcMain.handle(IPC.RegionConfirm, async (_e, rect: { x: number; y: number; width: number; height: number }) => {
      const region = confirmRegion(rect)
      // 区域变更广播到所有窗口（主界面刷新采集范围显示）
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send(IPC.RegionChangedEvent, region)
      }
      // 区域生效：回看缓冲运行中重建（新区域）；录制/推流中采集源不能重建（帧尺寸突变会损坏编码），延迟到停止后
      await applyRegionToActivePipelines()
      return region
    })
    ipcMain.handle(IPC.RegionCancel, () => closeRegionWindow())
    ipcMain.handle(IPC.RegionGetState, () => getRegion() as CaptureRegion)
    ipcMain.handle(IPC.AppRevealPath, (_e, path: string) => {
      if (typeof path === 'string' && path.trim()) shell.showItemInFolder(path)
    })
  }

  app.whenReady().then(() => {
    allowPreviewPermissions()
    registerIpc()
    createWindow()
    createTray(() => mainWindow)

    // 回看缓冲：设置开启时应用启动即后台常驻（PRD 6.2）
    const rr = startReplayIfEnabled()
    if (!rr.ok && rr.error) console.log('[replay] 未启动回看缓冲:', rr.error)

    // 自测模式：SCREENPUSHER_SELFTEST=1 时自动执行一轮录制 + 回看导出（供冒烟/CI，不改变正常行为）
    if (process.env['SCREENPUSHER_SELFTEST'] === '1') {
      setTimeout(() => {
        const rb = startReplayBuffer()
        console.log('[SELFTEST] startReplayBuffer:', JSON.stringify(rb))
        const r = startRecord({ region: 'fullscreen', fps: 30, bitrate: 4 })
        console.log('[SELFTEST] startRecord:', JSON.stringify(r))
        setTimeout(async () => {
          const s = await stopRecord()
          console.log('[SELFTEST] stopRecord:', JSON.stringify(s))
          const rp = await saveReplay()
          console.log('[SELFTEST] saveReplay:', JSON.stringify(rp))
          const rs = await stopReplayBuffer()
          console.log('[SELFTEST] stopReplayBuffer:', JSON.stringify(rs))
          console.log('[SELFTEST] replayState:', JSON.stringify(getReplayState()))
        }, 6000)
      }, 2000)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // 退出前：停止回看缓冲；录制中退出需二次确认（M4）
  app.on('before-quit', (e) => {
    isQuiting = true
    const st = getRecorderState()
    if (st.state === 'recording') {
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        title: '确认退出',
        message: '正在录制中，确定要退出吗？',
        detail: '退出将停止当前录制，未保存的片段会丢失。',
        buttons: ['继续录制', '停止并退出'],
        defaultId: 0,
        cancelId: 0
      })
      if (choice !== 1) {
        e.preventDefault()
        isQuiting = false
        return
      }
    }
    void stopReplayBuffer()
  })

  app.on('will-quit', () => {
    void stopReplayBuffer()
  })

  app.on('window-all-closed', () => {
    // 常驻托盘：所有窗口关闭不退出（真正退出走托盘「退出」）
  })
}
