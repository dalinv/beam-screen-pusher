// 光束录推 —— 本地 RTMP 收流服务（手动测试推流用）
// 用法：node scripts/nms-server.mjs
// 起服务后：应用里推流到 rtmp://127.0.0.1:1935/live/test
// 状态页：http://127.0.0.1:8000/api/streams
// 拉流验证：mpv rtmp://127.0.0.1:1935/live/test
const NodeMediaServer = (await import('node-media-server')).default

const nms = new NodeMediaServer({
  rtmp: { port: 1935, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 },
  http: { port: 8000, allow_origin: '*' }
})

nms.on('postPublish', (id, streamPath) => {
  console.log('[NMS] 收到推流:', streamPath)
})
nms.on('donePublish', (id, streamPath) => {
  console.log('[NMS] 推流结束:', streamPath)
})

nms.run()
console.log('[NMS] RTMP 收流服务已启动 :1935（状态页 http://127.0.0.1:8000/api/streams）')
console.log('[NMS] 按 Ctrl+C 停止服务')
