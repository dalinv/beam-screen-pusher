// 光束录推 —— 原生模块验证脚本（M1 验收：Node 中能取到一帧并输出尺寸信息）
// 用法：node scripts/check-native.mjs [--custom]
//   --custom 使用 640x360 自定义区域（避免全屏抓取）
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const mod = require(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'native', 'build', 'Release', 'screen-capture.node')
)

const custom = process.argv.includes('--custom')
const region = custom ? { x: 0, y: 0, width: 640, height: 360 } : 'fullscreen'

mod.CaptureInit(region, 30)
const info = mod.GetInfo()
const frame = mod.CaptureNext()
const expected = info.width * info.height * 4

console.log('区域        :', custom ? JSON.stringify(region) : 'fullscreen（虚拟屏幕）')
console.log('尺寸        :', `${info.width}x${info.height} @${info.fps}fps`)
console.log('起点        :', `${info.x},${info.y}`)
console.log('帧字节数    :', frame.length, '（期望', expected, '）')
console.log('校验        :', frame.length === expected ? 'PASS（BGRA WxHx4）' : 'FAIL')
console.log('帧前 8 字节 :', Buffer.from(frame.subarray(0, 8)).toString('hex'))
mod.CaptureStop()
console.log('验证完成 ✔')
