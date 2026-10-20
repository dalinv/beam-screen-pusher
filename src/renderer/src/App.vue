<script setup lang="ts">
// 光束录推 —— 主界面（M4：回看按钮 + 推流面板 + 实时预览 + 区域选择）
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAppStore } from './stores/app'
import PreviewPane from './components/PreviewPane.vue'

const store = useAppStore()
const fps = ref(30)
const bitrate = ref(4)
const rtmpUrl = ref('')
let stateTimer: ReturnType<typeof setInterval> | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null
let stopReplayListener: (() => void) | null = null
let stopRegionListener: (() => void) | null = null
let stopRegionDeferredListener: (() => void) | null = null

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = String(Math.floor(s / 3600)).padStart(2, '0')
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${h}:${m}:${ss}`
}

function showToast(text: string): void {
  store.replayToast = text
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    store.replayToast = ''
  }, 3500)
}

onMounted(async () => {
  store.version = await window.spAPI.getVersion()
  const s = await window.spAPI.getSettings()
  fps.value = s.record.fps
  bitrate.value = s.record.bitrate
  store.resolutionLabel = s.record.resolution === '1080p' ? '1080p' : s.record.resolution === '720p' ? '720p' : '原始'
  const rp = await window.spAPI.getReplayState()
  store.replayEnabled = rp.enabled
  store.replayRunning = rp.running
  store.replayDurationSec = rp.durationSec
  store.region = await window.spAPI.getRegionState()
  // 回看导出成功事件（含快捷键 F9 触发）
  stopReplayListener = window.spAPI.onReplaySaved((r) => {
    if (r.ok) {
      showToast(`回看已保存：${r.name ?? ''}（${r.durationSec ?? 0}s）`)
    } else {
      showToast(`回看保存失败：${r.error ?? '未知错误'}`)
    }
  })
  // 区域变更（区域选择窗口确认后主进程广播）
  stopRegionListener = window.spAPI.onRegionChanged((region) => {
    store.region = region
  })
  // 区域延迟生效提示（录制/推流进行中）
  stopRegionDeferredListener = window.spAPI.onRegionDeferred((message) => {
    showToast(message)
  })
  // 每秒轮询：录制 / 回看 / 推流 / 性能（M4 事件推送优化留待后续）
  stateTimer = setInterval(async () => {
    const s = await window.spAPI.getRecorderState()
    store.recordState = s.state
    store.elapsedSec = s.elapsedSec
    const r = await window.spAPI.getReplayState()
    store.replayEnabled = r.enabled
    store.replayRunning = r.running
    store.replayDurationSec = r.durationSec
    store.replaySegments = r.segments
    const st = await window.spAPI.getStreamState()
    store.streamState = st.state
    store.streamRetries = st.retries
    store.streamError = st.lastError
    if (st.state === 'streaming') store.streamElapsed++
    else if (st.state === 'idle') store.streamElapsed = 0
    const m = await window.spAPI.getMetrics()
    store.cpuPercent = m.cpuPercent
    store.memoryMB = m.memoryMB
    store.captureFps = m.captureFps
  }, 1000)
})

onUnmounted(() => {
  if (stateTimer) clearInterval(stateTimer)
  if (toastTimer) clearTimeout(toastTimer)
  stopReplayListener?.()
  stopRegionListener?.()
  stopRegionDeferredListener?.()
})

const regionText = computed(() => {
  const r = store.region
  if (r === 'fullscreen') return ''
  return `${r.x},${r.y} · ${r.width}×${r.height}`
})

async function onPickRegion(kind: 'fullscreen' | 'custom'): Promise<void> {
  // 录制/推流进行中禁止切换采集区域（区域变更需停止后生效）
  if (store.recordState !== 'idle' || store.streamState !== 'idle') {
    showToast('录制/推流进行中，请先停止后再切换采集区域')
    return
  }
  if (kind === 'fullscreen') {
    await window.spAPI.confirmRegion({ x: 0, y: 0, width: 0, height: 0 })
  } else {
    await window.spAPI.openRegionSelect()
  }
}

async function onStartRecord(): Promise<void> {
  store.lastError = ''
  store.lastOutput = ''
  store.lastOutputMeta = ''
  try {
    // region 需解包为普通对象（Pinia reactive Proxy 无法经 contextBridge 结构化克隆）
    const regionArg = store.region === 'fullscreen' ? 'fullscreen' : { ...store.region }
    const r = await window.spAPI.startRecord({ region: regionArg, fps: fps.value, bitrate: bitrate.value })
    if (!r.ok) {
      store.lastError = `启动录制失败：${r.error ?? '未知错误'}`
    } else {
      store.lastOutput = r.outPath ?? ''
      store.recordState = 'recording'
    }
  } catch (e) {
    store.lastError = `启动录制异常：${e instanceof Error ? e.message : String(e)}`
  }
}

async function onStopRecord(): Promise<void> {
  const r = await window.spAPI.stopRecord()
  store.recordState = 'idle'
  store.elapsedSec = 0
  if (!r.ok) {
    store.lastError = `停止录制异常：${r.error ?? '未知错误'}`
  } else {
    store.lastOutput = r.path ?? ''
    store.lastOutputMeta = `（${r.durationSec?.toFixed(1) ?? '-'}s，写入 ${r.framesWritten ?? '-'} 帧）`
  }
}

async function onOpenOutput(): Promise<void> {
  if (!store.lastOutput) return
  try {
    await window.spAPI.revealPath(store.lastOutput)
  } catch (e) {
    showToast(`打开失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

async function onTogglePause(): Promise<void> {
  if (store.recordState === 'recording') {
    await window.spAPI.pauseRecord()
    store.recordState = 'paused'
  } else if (store.recordState === 'paused') {
    await window.spAPI.resumeRecord()
    store.recordState = 'recording'
  }
}

/** 标题栏回看按钮：一键导出最近 N 秒 */
async function onSaveReplay(): Promise<void> {
  if (!store.replayEnabled) {
    showToast('回看未开启，请先在设置中开启')
    return
  }
  const r = await window.spAPI.saveReplay()
  if (r.ok) {
    showToast(`回看已保存：${r.name ?? ''}（${r.durationSec ?? 0}s）`)
  } else {
    showToast(`回看保存失败：${r.error ?? '未知错误'}`)
  }
}

async function onStartStream(): Promise<void> {
  store.streamError = ''
  if (!rtmpUrl.value.trim()) {
    store.streamError = '请输入 RTMP 地址'
    return
  }
  try {
    const regionArg = store.region === 'fullscreen' ? 'fullscreen' : { ...store.region }
    const r = await window.spAPI.startStream({
      region: regionArg,
      fps: fps.value,
      bitrate: bitrate.value,
      rtmpUrl: rtmpUrl.value.trim()
    })
    if (!r.ok) store.streamError = `启动推流失败：${r.error ?? '未知错误'}`
  } catch (e) {
    store.streamError = `启动推流异常：${e instanceof Error ? e.message : String(e)}`
  }
}

function onOpenSettings(): void {
  void window.spAPI.openSettings()
}

async function onStopStream(): Promise<void> {
  const r = await window.spAPI.stopStream()
  if (!r.ok) store.streamError = `停止推流异常：${r.error ?? '未知错误'}`
}

function streamLabel(): string {
  switch (store.streamState) {
    case 'connecting':
      return '连接中…'
    case 'streaming':
      return `推流中 ${fmt(store.streamElapsed)}`
    case 'reconnecting':
      return `重连中（第 ${store.streamRetries} 次）…`
    default:
      return ''
  }
}
</script>

<template>
  <div class="app">
    <header class="titlebar">
      <div class="logo">
        <span class="logo-dot"></span>
        光束录推 <span class="sub">BeamScreenPusher</span>
      </div>
      <div class="right">
        <!-- 回看入口（M3：标题栏一键保存，悬停提示；未开启时置灰） -->
        <button
          class="replay-btn"
          :class="{ ready: store.replayEnabled && store.replayRunning }"
          :disabled="!store.replayEnabled"
          :title="store.replayEnabled
            ? `保存最近 ${store.replayDurationSec} 秒为视频 · 快捷键 F9`
            : '回看未开启，请在设置中开启（M4）'"
          @click="onSaveReplay"
        >
          <span class="clock">◷</span>回看
          <span v-if="store.replayEnabled && store.replayRunning" class="ready-dot"></span>
        </button>
        <span class="rec-chip" :class="store.recordState" v-if="store.recordState !== 'idle'">
          <span class="dot"></span>{{ store.recordState === 'paused' ? '已暂停' : '录制中' }} {{ fmt(store.elapsedSec) }}
        </span>
        <span v-if="store.streamState === 'streaming'" class="rec-chip streaming">
          <span class="dot"></span>{{ streamLabel() }}
        </span>
        <span v-if="store.streamState === 'connecting' || store.streamState === 'reconnecting'" class="rec-chip connecting">
          <span class="dot"></span>{{ streamLabel() }}
        </span>
        <button class="gear-btn" title="设置" @click="onOpenSettings">⚙</button>
        <span class="ver">v{{ store.version }}</span>
      </div>
    </header>

    <main class="main">
      <!-- 回看 toast（右上角） -->
      <transition name="toast">
        <div v-if="store.replayToast" class="toast">{{ store.replayToast }}</div>
      </transition>

      <section class="preview">
        <PreviewPane />
      </section>

      <aside class="sidebar">
        <div class="card">
          <h4>采集范围</h4>
          <label class="radio" @click="onPickRegion('fullscreen')">
            <input type="radio" name="region" :checked="store.region === 'fullscreen'" />全屏
          </label>
          <label class="radio" @click="onPickRegion('custom')">
            <input type="radio" name="region" :checked="store.region !== 'fullscreen'" />自定义区域
            <span v-if="regionText" class="region-dim">{{ regionText }}</span>
          </label>
          <button v-if="store.region !== 'fullscreen'" class="region-again" @click="onPickRegion('custom')">
            重新选择
          </button>
        </div>
        <div class="card">
          <h4>参数设置</h4>
          <div class="row">
            <span>帧率</span>
            <select class="sel" v-model.number="fps" :disabled="store.recordState !== 'idle' || store.streamState !== 'idle'">
              <option :value="15">15</option>
              <option :value="30">30</option>
              <option :value="60">60</option>
            </select>
          </div>
          <div class="row">
            <span>码率</span>
            <select class="sel" v-model.number="bitrate" :disabled="store.recordState !== 'idle' || store.streamState !== 'idle'">
              <option :value="2">2 Mbps</option>
              <option :value="4">4 Mbps</option>
              <option :value="8">8 Mbps</option>
            </select>
          </div>
          <div class="row">
            <span>输出分辨率</span>
            <span class="val">{{ store.resolutionLabel }}</span>
          </div>
          <p class="hint-sm">更多选项（保存目录、分辨率、回看时长等）见 <a class="link" @click="onOpenSettings">设置</a></p>
        </div>
        <div class="card">
          <h4>性能</h4>
          <div class="row"><span>采集帧率</span><span class="val mono">{{ store.captureFps }} fps</span></div>
          <div class="row"><span>CPU 占用</span><span class="val mono">{{ store.cpuPercent }}%</span></div>
          <div class="row"><span>内存占用</span><span class="val mono">{{ store.memoryMB }} MB</span></div>
        </div>
        <div class="card">
          <h4>录制</h4>
          <div class="btns" v-if="store.recordState === 'idle'">
            <button class="btn red" @click="onStartRecord">● 开始录制</button>
          </div>
          <div class="btns" v-else>
            <button class="btn ghost" @click="onTogglePause">
              {{ store.recordState === 'paused' ? '▶ 恢复' : '⏸ 暂停' }}
            </button>
            <button class="btn red" @click="onStopRecord">■ 停止录制</button>
          </div>
          <p v-if="store.lastError" class="err">{{ store.lastError }}</p>
          <p v-if="store.lastOutput" class="out">
            已保存：<a class="out-link" href="javascript:;" title="在文件管理器中显示" @click="onOpenOutput">{{ store.lastOutput }}</a>
            <span v-if="store.lastOutputMeta" class="out-meta">{{ store.lastOutputMeta }}</span>
          </p>
        </div>
        <div class="card">
          <h4>直播推流（RTMP）</h4>
          <input
            class="rtmp-input"
            type="text"
            v-model="rtmpUrl"
            placeholder="rtmp://服务器地址/直播流密钥"
            :disabled="store.streamState !== 'idle'"
          />
          <div class="btns" v-if="store.streamState === 'idle'">
            <button class="btn blue" @click="onStartStream">▶ 开始推流</button>
          </div>
          <div class="btns" v-else>
            <button class="btn red" @click="onStopStream">■ 停止推流</button>
          </div>
          <p v-if="store.streamState !== 'idle'" class="stream-status">
            {{ streamLabel() }}
            <span v-if="store.streamRetries > 0" class="dim">（已重连 {{ store.streamRetries }} 次）</span>
          </p>
          <p v-if="store.streamError" class="err">{{ store.streamError }}</p>
        </div>
      </aside>
    </main>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
body {
  font-family: 'Microsoft YaHei', 'Segoe UI', sans-serif;
  background: #14171c;
  color: #e5e7eb;
  user-select: none;
}
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.titlebar {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #1a1e26;
  border-bottom: 1px solid #2a2f3a;
  padding: 0 12px;
  -webkit-app-region: drag;
}
.titlebar .right {
  display: flex;
  align-items: center;
  gap: 10px;
  -webkit-app-region: no-drag;
}
.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}
.logo-dot {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(135deg, #3b82f6, #22d3ee);
}
.sub {
  color: #6b7686;
  font-weight: 400;
}
.replay-btn {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid #3a4353;
  background: #2b3240;
  color: #e5e7eb;
  font-size: 12px;
  cursor: pointer;
}
.replay-btn:disabled {
  color: #7c8698;
  cursor: not-allowed;
  opacity: 0.45;
}
.replay-btn.ready {
  border-color: #2f6f4f;
  background: #1f3a2c;
  color: #d1fae5;
}
.clock {
  font-size: 13px;
}
.ready-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 6px #34d399;
}
.rec-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #fca5a5;
}
.rec-chip .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ef4444;
  box-shadow: 0 0 6px #ef4444;
  animation: pulse 1.2s infinite;
}
.rec-chip.paused .dot {
  background: #fbbf24;
  box-shadow: 0 0 6px #fbbf24;
  animation: none;
}
.rec-chip.streaming {
  color: #7dd3fc;
}
.rec-chip.streaming .dot {
  background: #38bdf8;
  box-shadow: 0 0 6px #38bdf8;
}
.rec-chip.connecting {
  color: #fbbf24;
}
.rec-chip.connecting .dot {
  background: #fbbf24;
  box-shadow: 0 0 6px #fbbf24;
  animation: none;
}
@keyframes pulse {
  50% {
    opacity: 0.45;
  }
}
.ver {
  font-size: 11px;
  color: #6b7686;
}
.gear-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid #3a4353;
  background: #2b3240;
  color: #c6ceda;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.gear-btn:hover {
  color: #fff;
  border-color: #4a5468;
}
.hint-sm {
  margin-top: 8px;
  font-size: 11px;
  color: #7c8698;
  line-height: 1.6;
}
.link {
  color: #7dd3fc;
  cursor: pointer;
  text-decoration: underline;
}
.mono {
  font-family: Consolas, monospace;
}
.main {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}
.preview {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0d0f13;
}
.preview-empty {
  text-align: center;
  color: #7c8698;
}
.preview-icon {
  font-size: 42px;
  color: #2b3240;
  margin-bottom: 12px;
}

.probe-result.fail {
  color: #f87171;
}
.sidebar {
  width: 352px;
  background: #1a1e26;
  border-left: 1px solid #2a2f3a;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}
.card {
  background: #21262f;
  border: 1px solid #2e3542;
  border-radius: 10px;
  padding: 12px;
}
.card h4 {
  font-size: 12px;
  color: #9aa5b8;
  font-weight: 600;
  margin-bottom: 10px;
}
.radio {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #d5dbe4;
  padding: 3px 0;
  cursor: pointer;
}
.radio input[type='radio'] {
  margin: 0;
  accent-color: #3b82f6;
  flex: none;
}
.region-dim {
  color: #7dd3fc;
  font-family: Consolas, monospace;
  font-size: 11px;
}
.region-again {
  margin-top: 6px;
  border: 1px solid #3a4353;
  background: #2b3240;
  color: #c6ceda;
  border-radius: 6px;
  font-size: 11px;
  padding: 4px 10px;
  cursor: pointer;
}
.region-again:hover {
  color: #fff;
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #a8b1bf;
  padding: 4px 0;
}
.row .val {
  color: #e5e7eb;
}
.sel {
  background: #2b3240;
  border: 1px solid #3a4353;
  color: #e5e7eb;
  border-radius: 6px;
  font-size: 12px;
  padding: 3px 8px;
}
.sel:disabled {
  opacity: 0.5;
}
.btns {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.btn {
  width: 100%;
  height: 38px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
}
.btn.red {
  background: #ef4444;
}
.btn.blue {
  background: #3b82f6;
}
.btn.ghost {
  background: #2b3240;
  border: 1px solid #3a4353;
  color: #d5dbe4;
}
.btn:disabled {
  background: #2b3240;
  color: #7c8698;
  cursor: not-allowed;
}
.rtmp-input {
  width: 100%;
  height: 34px;
  margin-bottom: 8px;
  background: #2b3240;
  border: 1px solid #3a4353;
  border-radius: 6px;
  color: #e5e7eb;
  font-size: 12px;
  padding: 0 10px;
  user-select: text;
}
.rtmp-input:disabled {
  opacity: 0.5;
}
.stream-status {
  margin-top: 10px;
  font-size: 11px;
  color: #7dd3fc;
}
.stream-status .dim {
  color: #6b7686;
}
.err {
  margin-top: 10px;
  font-size: 11px;
  color: #f87171;
  word-break: break-all;
}
.out-link {
  color: #7dd3fc;
  text-decoration: underline;
  cursor: pointer;
  word-break: break-all;
}
.out-link:hover {
  color: #93c5fd;
}
.out-meta {
  color: #7c8698;
}
.out {
  margin-top: 10px;
  font-size: 11px;
  color: #4ade80;
  word-break: break-all;
  line-height: 1.5;
}
.toast {
  position: absolute;
  top: 14px;
  right: 366px;
  z-index: 20;
  background: #1f3a2c;
  border: 1px solid #2f6f4f;
  color: #d1fae5;
  font-size: 12px;
  padding: 10px 16px;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
