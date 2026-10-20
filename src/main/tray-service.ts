// 光束录推 —— 托盘服务（M4，PRD F6）
// 托盘图标/菜单（显示主界面、开始/停止录制、设置、退出）、双击显示、录制中红点角标
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { startRecord, stopRecord } from './services/recorder-service'
import { openSettingsWindow } from './windows/settings-window'

let tray: Tray | null = null

function iconPath(recording: boolean): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(base, 'resources', recording ? 'tray-red.png' : 'tray.png')
}

function showMain(getMainWindow: () => BrowserWindow | null): void {
  const w = getMainWindow()
  if (w) {
    w.show()
    w.focus()
  }
}

export function createTray(getMainWindow: () => BrowserWindow | null): void {
  if (tray) return
  tray = new Tray(nativeImage.createFromPath(iconPath(false)).resize({ width: 16, height: 16 }))
  tray.setToolTip('光束录推 BeamScreenPusher')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主界面', click: () => showMain(getMainWindow) },
      { type: 'separator' },
      { label: '开始录制', click: () => void startRecord({ region: 'fullscreen', fps: 30, bitrate: 4 }) },
      { label: '停止录制', click: () => void stopRecord() },
      { type: 'separator' },
      { label: '设置', click: () => openSettingsWindow() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ])
  )
  tray.on('double-click', () => showMain(getMainWindow))
}

/** 录制状态变化时切换托盘图标（录制中显示红点角标） */
export function updateTrayRecording(recording: boolean): void {
  if (!tray) return
  tray.setImage(nativeImage.createFromPath(iconPath(recording)).resize({ width: 16, height: 16 }))
}
