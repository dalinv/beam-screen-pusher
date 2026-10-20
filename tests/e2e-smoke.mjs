// E2E 冒烟断言（M4 主流程，CDP 驱动真实应用实例）
// 覆盖：界面加载 / 原生模块探测 / 实时预览 / 回看启停闭环（M4 关键回归）/ 区域选择 / 性能面板
// 运行：node tests/e2e-smoke.mjs
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const PORT = 9224
const root = join(import.meta.dirname, '..')
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const userData = mkdtempSync(join(tmpdir(), 'beamscreenpusher-e2e-'))
const results = []
let child

// 0) 构建生产包（E2E 驱动 out/ 产物，确保包含最新代码）
const build = spawnSync(npx, ['electron-vite', 'build'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' })
if (build.status !== 0) {
  console.error('electron-vite build 失败:\n' + (build.stdout || '') + (build.stderr || ''))
  process.exit(1)
}
console.log('[e2e] build ok')

function log(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`)
}

const evalIn = async (page, expression, tolerateClose = false) => {
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('ws 连接失败'))
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  }
  const send = (method, params) =>
    new Promise((res, rej) => {
      const i = ++id
      pending.set(i, res)
      try {
        ws.send(JSON.stringify({ id: i, method, params: params || {} }))
      } catch (e) {
        rej(e)
        return
      }
      setTimeout(() => {
        if (pending.delete(i)) rej(new Error('CDP 响应超时（页面可能已关闭）'))
      }, 8000)
    })
  try {
    await send('Runtime.enable')
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) throw new Error('求值异常: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300))
    return r.result?.result?.value
  } catch (e) {
    if (tolerateClose) return undefined // 页面关闭导致的连接断开视为已执行
    throw e
  } finally {
    ws.close()
  }
}

const findPage = async (filter) => {
  try {
    const pages = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())
    return (filter ? pages.filter((p) => p.type === 'page' && p.url.includes(filter)) : pages.filter((p) => p.type === 'page'))[0]
  } catch {
    return undefined // dev 尚未就绪
  }
}

/** 发送任意 CDP 命令（Input.dispatchMouseEvent 等；页面关闭时可容错） */
const sendTo = async (page, method, params, tolerateClose = false) => {
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('ws 连接失败'))
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  }
  const send = (method, params) =>
    new Promise((res, rej) => {
      const i = ++id
      pending.set(i, res)
      try {
        ws.send(JSON.stringify({ id: i, method, params: params || {} }))
      } catch (e) {
        rej(e)
        return
      }
      setTimeout(() => {
        if (pending.delete(i)) rej(new Error('CDP 响应超时'))
      }, 8000)
    })
  try {
    return await send(method, params)
  } catch (e) {
    if (tolerateClose) return undefined // 页面关闭导致的连接断开视为已执行
    throw e
  } finally {
    ws.close()
  }
}
const waitPage = async (filter, timeout = 15000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const p = await findPage(filter)
    if (p) return p
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('等待页面超时: ' + filter)
}
const waitFor = async (fn, timeout = 10000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      /* 重试 */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('等待条件超时')
}

try {
  console.log('[e2e] launching dev instance...')
  child = spawn(npx, ['electron', '.', '--remote-debugging-port=' + PORT], {
    cwd: root,
    env: { ...process.env, SCREENPUSHER_USERDATA: userData },
    windowsHide: true,
    shell: process.platform === 'win32',
    stdio: 'ignore'
  })

  // 1) 主界面加载 + spAPI
  const main = await waitPage('index.html')
  const hasApi = await evalIn(main, '!!window.spAPI')
  log('主界面加载且 spAPI 就绪', hasApi === true)

  // 2) 原生模块探测
  const probe = await evalIn(main, 'window.spAPI.probeCapture().then(r=>r)')
  log('原生采集模块探测', probe?.ok === true, probe?.ok ? `(${probe.width}x${probe.height}@${probe.fps})` : JSON.stringify(probe))

  // 3) 实时预览出流
  await waitFor(async () => {
    const v = await evalIn(main, `(() => { const v = document.querySelector('video'); return v ? v.readyState >= 2 && !!v.srcObject : false })()`)
    return v
  })
  const vinfo = await evalIn(main, `(() => { const v = document.querySelector('video'); return JSON.stringify({vw:v.videoWidth, vh:v.videoHeight}) })()`)
  log('实时预览出流', true, vinfo)

  // 4) 回看启停闭环（M4 关键回归）
  await evalIn(main, 'window.spAPI.setSettings({replay:{enabled:true}}).then(()=>"ok")')
  await waitFor(async () => (await evalIn(main, 'window.spAPI.getReplayState().then(s=>s.running)')) === true)
  log('回看开启 → 缓冲启动', true)

  // 5) 区域选择（回看运行中）：真实 UI 链路——拖拽框选 → 点击「使用此区域」按钮 → 区域生效 + 回看按新区域重建
  await evalIn(main, 'window.spAPI.openRegionSelect().then(()=>"opened")')
  const region = await waitPage('region.html')
  log('区域选择窗口打开', true)

  // 真实拖拽：mousedown(300,300) → mousemove(500,400) → mouseup（窗口逻辑坐标）
  await sendTo(region, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: 300, y: 300, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' })
  await sendTo(region, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 500, y: 400, button: 'left', buttons: 1, pointerType: 'mouse' })
  await sendTo(region, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: 500, y: 400, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' })
  const sel = JSON.parse(await evalIn(region, `(() => { const el = document.querySelector('.region-box'); if (!el) return JSON.stringify(null); const s = el.style; return JSON.stringify({x:parseInt(s.left),y:parseInt(s.top),w:parseInt(s.width),h:parseInt(s.height)}) })()`))
  log('拖拽生成选区框 200x100', !!sel && sel.w === 200 && sel.h === 100, sel ? `${sel.x},${sel.y} ${sel.w}x${sel.h}` : '未生成')

  // 真实点击「使用此区域」按钮（回归：按钮点击不得被拖拽逻辑吞掉、选区不得跳变）
  const btnRaw = await evalIn(region, `(() => { const b = document.querySelector('.btn.primary'); const r = b.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}) })()`)
  const btn = JSON.parse(btnRaw)
  await sendTo(region, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' })
  await sendTo(region, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' })
  await waitFor(async () => {
    const s = await evalIn(main, 'window.spAPI.getRegionState().then(r=>r)')
    return s && typeof s === 'object' && s.width > 0
  })
  const rstate = await evalIn(main, 'window.spAPI.getRegionState().then(r=>r)')
  // 期望物理 = 逻辑(300,300,200,100) × scaleFactor；比例 200:100=2 校验最稳
  const uiOk = Math.abs(rstate.width / rstate.height - 2) < 0.02 && rstate.width >= 200 && rstate.x > 0 && rstate.y > 0
  log('点击「使用此区域」→ 区域生效（真实 UI 链路回归）', uiOk, `物理 ${rstate.x},${rstate.y} ${rstate.width}x${rstate.height}（逻辑 300,300 200x100）`)
  // 关键修复：回看运行中改区域 → 回看缓冲按新区域重建，running 仍为 true
  await waitFor(async () => (await evalIn(main, 'window.spAPI.getReplayState().then(s=>s.running)')) === true)
  const rpState = await evalIn(main, 'window.spAPI.getReplayState().then(s=>({running:s.running,segments:s.segments}))')
  log('回看缓冲按新区域重建（区域变更即时生效）', rpState.running === true, `running=${rpState.running}`)
  // 5.2) 预览随区域切换为裁剪模式（Canvas 显示区域内容，而非全屏视频）
  await waitFor(async () => (await evalIn(main, `(() => { const cv = document.querySelector('canvas.pv-canvas'); return !!cv && cv.offsetWidth > 0 })()`)) === true, 8000)
  log('预览切换为区域裁剪模式（Canvas 显示区域内容）', true, 'canvas 已激活')

  // 6) 区域录制：真实点击 UI「开始录制」按钮（回归：Pinia reactive region 无法过 contextBridge → 按钮无反应）
  await evalIn(main, `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('开始录制')); const r = b.getBoundingClientRect(); window.__recBtn = {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}; return JSON.stringify(window.__recBtn) })()`)
  const recBtn = JSON.parse(await evalIn(main, 'JSON.stringify(window.__recBtn)'))
  await sendTo(main, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: recBtn.x, y: recBtn.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' })
  await sendTo(main, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: recBtn.x, y: recBtn.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' })
  await waitFor(async () => (await evalIn(main, 'window.spAPI.getRecorderState().then(s=>s.state)')) === 'recording', 8000)
  log('真实点击「开始录制」→ 录制启动（reactive region 解包回归）', true, 'recordState=recording')

  // 6.1) 录制中禁止切换区域（guard：点击全屏单选不生效）
  await evalIn(main, `(() => { const els = [...document.querySelectorAll('label, button')].filter(x => x.textContent.trim().startsWith('全屏')); const b = els[0]; if (!b) return 'NO_EL'; const r = b.getBoundingClientRect(); window.__fsBtn = {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}; return JSON.stringify(window.__fsBtn) })()`)
  const fsBtn = JSON.parse(await evalIn(main, 'JSON.stringify(window.__fsBtn)'))
  await sendTo(main, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: fsBtn.x, y: fsBtn.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' })
  await sendTo(main, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: fsBtn.x, y: fsBtn.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' })
  await new Promise((r) => setTimeout(r, 600))
  const regionAfterGuard = await evalIn(main, 'window.spAPI.getRegionState().then(r=>r)')
  log('录制中禁止切换区域（guard 生效）', typeof regionAfterGuard === 'object' && regionAfterGuard.x === rstate.x, `区域仍为自定义 ${regionAfterGuard.x},${regionAfterGuard.y}`)
  await evalIn(main, 'window.spAPI.stopRecord().then(r=>r)')

  // 7) 回看关闭
  await evalIn(main, 'window.spAPI.setSettings({replay:{enabled:false}}).then(()=>"ok")')
  await waitFor(async () => (await evalIn(main, 'window.spAPI.getReplayState().then(s=>s.running)')) === false)
  log('回看关闭 → 缓冲停止', true)

  // 8) 恢复全屏
  await evalIn(main, 'window.spAPI.confirmRegion({x:0,y:0,width:0,height:0}).then(()=>"ok")')
  await waitFor(async () => (await evalIn(main, 'window.spAPI.getRegionState().then(r=>r)')) === 'fullscreen')
  log('恢复全屏采集', true)
  // 8.1) 恢复全屏 → 预览回视频模式
  await waitFor(async () => (await evalIn(main, `(() => { const vd = document.querySelector('video.pv-video'); return !!vd && vd.offsetWidth > 0 })()`)) === true, 8000)
  log('恢复全屏 → 预览回视频模式', true)

  // 9) 性能面板（字段：cpuPercent / memoryMB / captureFps）
  const m = await evalIn(main, 'window.spAPI.getMetrics().then(r=>r)')
  log('性能指标返回', typeof m?.cpuPercent === 'number' && typeof m?.memoryMB === 'number' && typeof m?.captureFps === 'number', `cpu=${m?.cpuPercent}% mem=${m?.memoryMB}MB fps=${m?.captureFps}`)

  const failed = results.filter((r) => !r.ok)
  console.log(`\n===== E2E ${failed.length === 0 ? 'PASS' : 'FAIL'} ===== (${results.length - failed.length}/${results.length})`)
} catch (e) {
  console.error('\n===== E2E FAIL =====')
  console.error(e)
  process.exitCode = 1
} finally {
  if (child) child.kill()
  try {
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  } catch {
    /* 忽略 */
  }
}
setTimeout(() => process.exit(process.exitCode || 0), 300)
