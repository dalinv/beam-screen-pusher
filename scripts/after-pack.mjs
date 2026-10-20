// 光束录推 —— electron-builder afterPack：Windows 应用图标强制注入
// 背景：electron-builder 26 的图标注入环节在本机未生效（产物保留 Electron 默认图标，rcedit 对照实验证实 icon.ico 有效）。
// 兜底方案：打包完成后用 rcedit 直接把 build/icon.ico 注入 BeamScreenPusher.exe（NSIS/portable 均基于注入后的 exe）。
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export default async function afterPack(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'win32') return
  const exe = join(appOutDir, 'BeamScreenPusher.exe')
  if (!existsSync(exe)) throw new Error('afterPack: 未找到 ' + exe)
  const rcedit = join(process.cwd(), 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe')
  const icon = join(process.cwd(), 'build', 'icon.ico')
  if (!existsSync(rcedit)) throw new Error('afterPack: 缺少 rcedit（npm i -D rcedit）')
  if (!existsSync(icon)) throw new Error('afterPack: 缺少图标 ' + icon)
  const r = spawnSync(rcedit, [exe, '--set-icon', icon], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('rcedit 图标注入失败: ' + (r.stderr || r.stdout || `exit ${r.status}`))
  console.log('[afterPack] 图标已注入', exe)
}
