// 光束录推 —— 资源路径服务（M4：dev / 打包后资源定位统一）
// dev   ：原生模块走 app.getAppPath()/native/build/Release，ffmpeg 走 node_modules
// 打包后：原生模块与 ffmpeg 经 electron-builder extraResources 放到 resources/（见 发布规范）
import { app } from 'electron'
import { join } from 'node:path'

/** C++ 采集原生模块路径 */
export function getNativeModulePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'native', 'screen-capture.node')
    : join(app.getAppPath(), 'native', 'build', 'Release', 'screen-capture.node')
}

/** ffmpeg 可执行文件路径 */
export function getFfmpegPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@ffmpeg-installer/ffmpeg').path as string
}
