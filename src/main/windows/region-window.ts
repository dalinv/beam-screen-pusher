// 光束录推 —— 区域选择窗口（M4，PRD F2：自定义采集区域）
// 全屏透明窗口 + 遮罩拖拽框选；确认时按 DPI 缩放换算为物理像素写入 region-service
import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { setRegion } from '../services/region-service'
import type { CaptureRegion } from '../../shared/types'

let regionWindow: BrowserWindow | null = null

export function openRegionWindow(): void {
  if (regionWindow && !regionWindow.isDestroyed()) {
    regionWindow.focus()
    return
  }
  const display = screen.getPrimaryDisplay()
  regionWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  regionWindow.on('ready-to-show', () => regionWindow?.show())
  regionWindow.on('closed', () => {
    regionWindow = null
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    regionWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/region.html')
  } else {
    regionWindow.loadFile(join(__dirname, '../renderer/region.html'))
  }
}

export function closeRegionWindow(): void {
  if (regionWindow && !regionWindow.isDestroyed()) regionWindow.close()
}

/** 区域确认（region 为窗口内逻辑坐标，DPI 缩放换算为物理像素；宽高 ≤0 视为全屏） */
export function confirmRegion(rect: { x: number; y: number; width: number; height: number }): CaptureRegion {
  let region: CaptureRegion
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    region = 'fullscreen'
  } else {
    const scale = screen.getPrimaryDisplay().scaleFactor
    // 宽高对齐偶数：libx264/yuv420p 编码器要求偶数尺寸（1.25 缩放下逻辑偶数 × scale 常为奇数，会致 ffmpeg 拒编退出）
    const toEven = (n: number): number => Math.round(n * scale) & ~1
    region = {
      x: Math.round(rect.x * scale),
      y: Math.round(rect.y * scale),
      width: Math.max(2, toEven(rect.width)),
      height: Math.max(2, toEven(rect.height))
    }
  }
  setRegion(region)
  closeRegionWindow()
  return region
}
