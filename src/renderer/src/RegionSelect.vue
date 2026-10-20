<script setup lang="ts">
// 区域选择（M4，PRD F2）：全屏遮罩 + 拖拽框选 → 确认后写入主进程
// 坐标为窗口内逻辑像素，主进程按 DPI 换算为物理像素
import { onMounted, onUnmounted, reactive, ref } from 'vue'

const rect = reactive({ x: 0, y: 0, w: 0, h: 0, visible: false })
const start = reactive({ x: 0, y: 0 })
const dragging = ref(false)
const confirmed = ref(false)

function onMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return
  // 点击按钮/交互区不触发拖拽（否则按钮点击会被当作拖拽起点，重置选区）
  const target = e.target as HTMLElement
  if (target.closest('button')) return
  dragging.value = true
  start.x = e.clientX
  start.y = e.clientY
  rect.x = start.x
  rect.y = start.y
  rect.w = 0
  rect.h = 0
  rect.visible = true
}

function onMouseMove(e: MouseEvent): void {
  if (!dragging.value) return
  const cx = e.clientX
  const cy = e.clientY
  rect.x = Math.min(start.x, cx)
  rect.y = Math.min(start.y, cy)
  rect.w = Math.abs(cx - start.x)
  rect.h = Math.abs(cy - start.y)
}

function onMouseUp(): void {
  if (!dragging.value) return
  dragging.value = false
  if (rect.w < 4 || rect.h < 4) {
    rect.visible = false
  }
}

async function onConfirm(): Promise<void> {
  if (!rect.visible || rect.w < 4 || rect.h < 4) return
  confirmed.value = true
  await window.spAPI.confirmRegion({ x: rect.x, y: rect.y, width: rect.w, height: rect.h })
}

async function onCancel(): Promise<void> {
  await window.spAPI.cancelRegion()
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') void onCancel()
}

onMounted(() => {
  window.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('mousedown', onMouseDown)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="stage">
    <div class="tip">拖动选择录制区域 · 按 Esc 取消</div>

    <!-- 高亮框：box-shadow 外扩形成暗色遮罩，框内为"挖空" -->
    <div
      v-if="rect.visible"
      class="region-box"
      :style="{
        left: rect.x + 'px',
        top: rect.y + 'px',
        width: rect.w + 'px',
        height: rect.h + 'px'
      }"
    >
      <div class="size-label">{{ rect.w }} × {{ rect.h }}</div>

      <div v-if="!dragging" class="confirm-bar">
        <span class="confirm-info">
          区域 {{ rect.x }}, {{ rect.y }} · {{ rect.w }} × {{ rect.h }}
        </span>
        <button class="btn primary" :disabled="confirmed" @click="onConfirm">
          {{ confirmed ? '已使用 ✓' : '使用此区域' }}
        </button>
        <button class="btn" :disabled="confirmed" @click="onCancel">取消</button>
      </div>
    </div>

    <div v-if="dragging" class="drag-hint">
      {{ rect.w }} × {{ rect.h }}
    </div>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
html,
body,
#app {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
body {
  font-family: 'Microsoft YaHei', 'Segoe UI', sans-serif;
  background: rgba(0, 0, 0, 0.45);
  cursor: crosshair;
  user-select: none;
}
</style>

<style scoped>
.stage {
  width: 100%;
  height: 100%;
  position: relative;
}
.tip {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(20, 23, 28, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #e5e7eb;
  font-size: 13px;
  padding: 8px 18px;
  border-radius: 8px;
  z-index: 20;
}
.region-box {
  position: fixed;
  border: 2px dashed #facc15;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
  z-index: 10;
}
.size-label {
  position: absolute;
  top: -28px;
  left: 0;
  background: #facc15;
  color: #1a1e26;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  font-family: Consolas, monospace;
}
.confirm-bar {
  position: absolute;
  bottom: -58px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(20, 23, 28, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 8px 12px;
  border-radius: 10px;
  white-space: nowrap;
}
.confirm-info {
  color: #cbd5e1;
  font-size: 12px;
  margin-right: 6px;
  font-family: Consolas, monospace;
}
.btn {
  border: none;
  border-radius: 6px;
  padding: 7px 16px;
  font-size: 12px;
  cursor: pointer;
  background: #2b3240;
  color: #cbd5e1;
}
.btn.primary {
  background: #3b82f6;
  color: #fff;
}
.btn.primary:disabled {
  background: #1d5ac2;
  cursor: default;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.drag-hint {
  position: fixed;
  top: 8px;
  right: 12px;
  color: #facc15;
  font-size: 13px;
  font-family: Consolas, monospace;
  z-index: 20;
}
</style>
