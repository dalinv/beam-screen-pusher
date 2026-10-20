// 通过 CDP 检查渲染层状态（M4 验证用）：node scripts/cdp-check.mjs [JS表达式] [页面URL子串]
const expr = process.argv[2] || `(() => {
  const v = document.querySelector('video');
  return JSON.stringify({
    hasAPI: !!window.spAPI,
    video: v ? { ready: v.readyState, paused: v.paused, vw: v.videoWidth, vh: v.videoHeight, srcObj: !!v.srcObject } : null,
    body: document.body.innerText.slice(0, 200)
  });
})()`
const pageFilter = process.argv[3] || ''
const port = process.argv[4] || '9222'

const pages = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
const page = (pageFilter ? pages.filter((p) => p.type === 'page' && p.url.includes(pageFilter)) : pages.filter((p) => p.type === 'page'))[0]
if (!page) throw new Error('未找到匹配页面')
console.log('页面:', page.title, '|', page.url)

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
function send(method, params) {
  return new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params: params || {} }))
  })
}
await send('Runtime.enable')
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
if (r.result?.exceptionDetails) {
  console.log('求值异常:', JSON.stringify(r.result.exceptionDetails).slice(0, 400))
} else {
  console.log('结果:', r.result?.result?.value)
}
ws.close()
