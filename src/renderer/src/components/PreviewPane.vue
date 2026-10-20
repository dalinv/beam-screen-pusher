<script setup lang="ts">
// 实时预览（M4，PRD F5）：desktopCapturer 源 → getUserMedia 流式播放
// 区域模式（M4.1）：Canvas 按当前采集区域裁剪绘制——预览内容与录制内容一致，而非全屏+框
// 独立于 C++ 采集链路（预览不参与编码/录制，两路互不干扰）
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const videoRef = ref<HTMLVideoElement | null>(null)
const frameRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const error = ref('')
let stream: MediaStream | null = null
let rafId = 0

/** 区域模式（非全屏）：预览显示所选区域内容 */
const regionActive = computed(() => store.region !== 'fullscreen')

/** canvas 尺寸按区域宽高比 contain 适配容器（内部分辨率 × dpr 提升清晰度） */
function computeCanvasSize(): void {
  const el = frameRef.value
  const cv = canvasRef.value
  if (!el || !cv || store.region === 'fullscreen') return
  const vw = el.clientWidth
  const vh = el.clientHeight
  const rw = store.region.width
  const rh = store.region.height
  if (!rw || !rh) return
  const aspect = rw / rh
  let w: number, h: number
  if (vw / vh > aspect) {
    h = vh
    w = vh * aspect
  } else {
    w = vw
    h = vw / aspect
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  cv.width = Math.max(2, Math.round(w * dpr))
  cv.height = Math.max(2, Math.round(h * dpr))
  cv.style.width = `${Math.round(w)}px`
  cv.style.height = `${Math.round(h)}px`
}

/** 区域模式渲染循环：从全屏流裁剪区域矩形绘制到 canvas（区域为主屏物理坐标，与源尺寸同系） */
function drawLoop(): void {
  if (!regionActive.value) return
  const cv = canvasRef.value
  const vd = videoRef.value
  if (cv && vd && vd.readyState >= 2) {
    const r = store.region
    if (typeof r === 'object' && r.width > 0 && r.height > 0) {
      const ctx = cv.getContext('2d')
      if (ctx) {
        ctx.drawImage(vd, r.x, r.y, r.width, r.height, 0, 0, cv.width, cv.height)
      }
    }
  }
  rafId = requestAnimationFrame(drawLoop)
}

watch(regionActive, (active) => {
  cancelAnimationFrame(rafId)
  if (active) {
    computeCanvasSize()
    rafId = requestAnimationFrame(drawLoop)
  }
})
watch(
  () => store.region,
  () => {
    if (regionActive.value) computeCanvasSize()
  }
)

async function startPreview(): Promise<void> {
  try {
    const src = await window.spAPI.getPreviewSource()
    if (!src) {
      error.value = '未找到可捕获的屏幕'
      return
    }
    store.previewW = src.width
    store.previewH = src.height
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    })
    if (!videoRef.value) return
    videoRef.value.srcObject = stream
    await videoRef.value.play()
    error.value = ''
  } catch (e) {
    error.value = '预览启动失败：' + (e instanceof Error ? e.message : String(e))
  }
}


onMounted(() => {
  void startPreview()
  if (regionActive.value) {
    computeCanvasSize()
    rafId = requestAnimationFrame(drawLoop)
  }
})

onUnmounted(() => {
  cancelAnimationFrame(rafId)
  if (stream) {
    for (const t of stream.getTracks()) t.stop()
    stream = null
  }
})
</script>

<template>
  <section class="preview">
    <div v-if="error" class="preview-empty">
      <div class="preview-icon">▶</div>
      <p class="preview-err">{{ error }}</p>
      <button class="probe-btn" @click="startPreview">重试预览</button>
    </div>

    <template v-else>
      <div ref="frameRef" class="preview-frame">
        <!-- 全屏模式：直接播放；区域模式：Canvas 裁剪区域内容 -->
        <video ref="videoRef" v-show="!regionActive" autoplay muted playsinline class="pv-video"></video>
        <canvas ref="canvasRef" v-show="regionActive" class="pv-canvas"></canvas>
      </div>
    </template>
  </section>
</template>

<style scoped>
.preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #0d0f13;
  position: relative;
  min-width: 0;
  padding: 12px;
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
.preview-err {
  font-size: 13px;
  color: #f87171;
  max-width: 420px;
  word-break: break-all;
}
.probe-btn {
  margin-top: 16px;
  height: 34px;
  padding: 0 18px;
  border: none;
  border-radius: 8px;
  background: #3b82f6;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.preview-frame {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.pv-video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
  background: #000;
}
.pv-canvas {
  display: block;
  border-radius: 6px;
  background: #000;
}
</style>
