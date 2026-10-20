// 光束录推 —— 预览服务（M4，PRD F5：实时预览）
// 用 desktopCapturer 提供主屏源 ID，渲染进程 getUserMedia 拉流播放（独立于 C++ 采集链路）
import { desktopCapturer, screen, session } from 'electron'

export interface PreviewSource {
  id: string
  name: string
  width: number
  height: number
}

/** 返回主屏捕获源（sourceId 供渲染进程 getUserMedia） */
export async function getPreviewSource(): Promise<PreviewSource | null> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 320, height: 180 }
  })
  if (sources.length === 0) return null
  const primary = screen.getPrimaryDisplay()
  const src = sources.find((s) => s.display_id === String(primary.id)) ?? sources[0]
  return { id: src.id, name: src.name, width: primary.size.width, height: primary.size.height }
}

/** 放行桌面捕获/媒体权限（预览 getUserMedia 需要） */
export function allowPreviewPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture')
  })
}
