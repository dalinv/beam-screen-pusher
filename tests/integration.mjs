// 集成自测断言（M2~M4 全链路：采集 → 编码 → 录制 MP4 → 回看缓冲 → 导出）
// 流程：electron-vite build → 以 SCREENPUSHER_SELFTEST=1 启动生产构建 → 轮询日志 → 断言全部 ok + 产物真实可读
// 运行：node tests/integration.mjs
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const root = join(import.meta.dirname, '..')
const results = {}
const failures = []

// 1) 构建生产包
console.log('[integration] build...')
const build = spawnSync(npx, ['electron-vite', 'build'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' })
assert.equal(build.status, 0, `electron-vite build 失败:\n${build.stdout}\n${build.stderr}`)

// 2) 启动自测（独立 userData 隔离，避免开发配置残留）
const userData = mkdtempSync(join(tmpdir(), 'beamscreenpusher-it-'))
console.log('[integration] launching selftest electron...')
let buffer = ''
const child = spawn(npx, ['electron', '.'], {
  cwd: root,
  env: { ...process.env, SCREENPUSHER_SELFTEST: '1', SCREENPUSHER_USERDATA: userData },
  windowsHide: true,
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'pipe']
})
child.stdout.on('data', (d) => {
  buffer += d.toString()
})
child.stderr.on('data', (d) => {
  buffer += d.toString()
})

// 3) 轮询输出中 SELFTEST 完成
const deadline = Date.now() + 30000
const waitLog = () => new Promise((resolve) => {
  const poll = setInterval(() => {
    if (buffer.includes('[SELFTEST] replayState:')) {
      clearInterval(poll)
      resolve(buffer)
    }
    if (Date.now() > deadline) {
      clearInterval(poll)
      resolve(null)
    }
  }, 500)
})

try {
  const log = await waitLog()
  assert.ok(log, `自测超时（30s）未见 replayState 输出`)

  // 4) 逐条断言
  const grab = (label) => {
    const m = log.match(new RegExp(`\\[SELFTEST\\] ${label}: (\\{.*\\})`))
    assert.ok(m, `缺少 [SELFTEST] ${label} 输出`)
    return JSON.parse(m[1])
  }
  const rb = grab('startReplayBuffer')
  const rc = grab('startRecord')
  const st = grab('stopRecord')
  const rp = grab('saveReplay')
  const rs = grab('stopReplayBuffer')
  const state = grab('replayState')

  assert.equal(rb.ok, true); results.startReplayBuffer = `ok (${rb.width}x${rb.height}@${rb.fps})`
  assert.equal(rc.ok, true); results.startRecord = `ok (${rc.width}x${rc.height}@${rc.fps})`
  assert.equal(st.ok, true, `stopRecord 失败: ${JSON.stringify(st)}`)
  assert.ok(st.framesWritten > 30, `录制帧数应 >30，实际 ${st.framesWritten}`)
  assert.equal(rp.ok, true, `saveReplay 失败: ${rp.error}`)
  assert.ok(rp.durationSec >= 1, `回看时长应 ≥1s，实际 ${rp.durationSec}`)
  assert.equal(rs.ok, true)
  assert.equal(state.running, false, '回看缓冲应已停止')
  assert.equal(state.enabled, false, '自测后回看应复位为关闭')

  // 5) 产物真实可读：录制 mp4 存在且非空
  assert.ok(st.path && existsSync(st.path), `录制产物不存在: ${st.path}`)
  const recSize = spawnSync('node', ['-e', `console.log(require('fs').statSync(${JSON.stringify(st.path)}).size)`]).stdout.toString()
  assert.ok(parseInt(recSize) > 100_000, `录制产物过小: ${recSize} bytes`)
  const repSize = spawnSync('node', ['-e', `console.log(require('fs').statSync(${JSON.stringify(rp.path)}).size)`]).stdout.toString()
  assert.ok(parseInt(repSize) > 50_000, `回看产物过小: ${repSize} bytes`)

  console.log('\n===== INTEGRATION PASS =====')
  console.log(JSON.stringify(results, null, 2))
  console.log(`录制产物: ${st.path} (${Math.round(parseInt(recSize) / 1024)}KB)`)
  console.log(`回看产物: ${rp.path} (${Math.round(parseInt(repSize) / 1024)}KB)`)
} catch (e) {
  failures.push(e.message)
  console.error('\n===== INTEGRATION FAIL =====')
  console.error(e)
} finally {
  child.kill()
  try {
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  } catch {
    /* 临时目录未释放时留给系统清理 */
  }
}
// 强制退出：避免 electron 子进程树残留导致脚本挂住
setTimeout(() => process.exit(failures.length ? 1 : 0), 300)
