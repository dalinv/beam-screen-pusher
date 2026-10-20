<script setup lang="ts">
// 设置窗口（M4，PRD 12.2 原型：左侧导航 + 表单）
import { computed, onMounted, reactive, ref } from 'vue'
import type { SettingsDto } from '@shared/types'

const props = defineProps<{ windowKind?: string }>()

const active = ref('record')
const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const version = ref('')
const form = reactive<SettingsDto>({
  replay: { enabled: false, durationSec: 10, hotkey: 'F9', dir: '', fps: 30, bitrate: 4 },
  record: { fps: 30, bitrate: 4, resolution: 'original', outDir: '' },
  stream: { bitrate: 4, maxRetries: 3 }
})

const navs = [
  { key: 'record', label: '录制' },
  { key: 'replay', label: '回看' },
  { key: 'stream', label: '推流' },
  { key: 'general', label: '通用' }
]

const replayDurationLabel = computed(() => `${form.replay.durationSec} 秒`)

onMounted(async () => {
  try {
    const s = await window.spAPI.getSettings()
    Object.assign(form.replay, s.replay)
    Object.assign(form.record, s.record)
    Object.assign(form.stream, s.stream)
    version.value = await window.spAPI.getVersion()
  } catch (e) {
    console.error('读取设置失败:', e)
  }
  loading.value = false
})

async function save(): Promise<void> {
  saving.value = true
  saved.value = false
  try {
    await window.spAPI.setSettings({
      replay: { ...form.replay },
      record: { ...form.record },
      stream: { ...form.stream }
    })
    saved.value = true
    setTimeout(() => (saved.value = false), 2000)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="settings">
    <aside class="nav">
      <div class="nav-title">光束录推</div>
      <div
        v-for="n in navs"
        :key="n.key"
        class="nav-item"
        :class="{ active: active === n.key }"
        @click="active = n.key"
      >
        {{ n.label }}
      </div>
    </aside>

    <main class="content">
      <template v-if="loading">
        <div class="placeholder">加载中…</div>
      </template>

      <!-- 录制 -->
      <section v-else-if="active === 'record'" class="panel">
        <h2>录制设置</h2>
        <div class="row">
          <label>帧率</label>
          <select v-model.number="form.record.fps">
            <option :value="15">15 fps（省资源）</option>
            <option :value="30">30 fps（推荐）</option>
            <option :value="60">60 fps（高帧率）</option>
          </select>
        </div>
        <div class="row">
          <label>码率</label>
          <select v-model.number="form.record.bitrate">
            <option :value="2">2 Mbps（画质一般）</option>
            <option :value="4">4 Mbps（推荐）</option>
            <option :value="8">8 Mbps（高画质）</option>
          </select>
        </div>
        <div class="row">
          <label>输出分辨率</label>
          <select v-model="form.record.resolution">
            <option value="original">原始分辨率（不缩放）</option>
            <option value="1080p">1080p（推荐）</option>
            <option value="720p">720p（省资源）</option>
          </select>
        </div>
        <div class="row">
          <label>保存目录</label>
          <input v-model="form.record.outDir" spellcheck="false" />
        </div>
        <p class="hint">保存目录不存在时会自动创建；录制中修改的分辨率/帧率/码率从下次录制生效。</p>
      </section>

      <!-- 回看 -->
      <section v-else-if="active === 'replay'" class="panel">
        <h2>回看设置</h2>
        <div class="row switch-row">
          <label>启用回看</label>
          <button class="switch" :class="{ on: form.replay.enabled }" @click="form.replay.enabled = !form.replay.enabled">
            <span class="knob"></span>
          </button>
        </div>
        <div class="row">
          <label>回看时长</label>
          <div class="slider-wrap">
            <input v-model.number="form.replay.durationSec" type="range" min="5" max="60" step="5" />
            <span class="slider-val">{{ replayDurationLabel }}</span>
          </div>
        </div>
        <div class="row">
          <label>保存快捷键</label>
          <input v-model="form.replay.hotkey" class="hotkey" spellcheck="false" maxlength="16" />
        </div>
        <div class="row">
          <label>保存目录</label>
          <input v-model="form.replay.dir" spellcheck="false" />
        </div>
        <p class="hint">标题栏「回看」按钮与快捷键均可触发；点击后直接保存最近 N 秒为 MP4，不弹窗。修改时长/快捷键后立即生效。</p>
      </section>

      <!-- 推流 -->
      <section v-else-if="active === 'stream'" class="panel">
        <h2>推流设置</h2>
        <div class="row">
          <label>默认码率</label>
          <select v-model.number="form.stream.bitrate">
            <option :value="2">2 Mbps</option>
            <option :value="4">4 Mbps（推荐）</option>
            <option :value="8">8 Mbps</option>
          </select>
        </div>
        <div class="row">
          <label>断线重连次数</label>
          <input v-model.number="form.stream.maxRetries" type="number" min="0" max="10" class="num" />
        </div>
        <p class="hint">推流断线后按 2s / 4s / 8s 退避自动重连，超过次数后停止并提示。</p>
      </section>

      <!-- 通用 -->
      <section v-else class="panel">
        <h2>通用</h2>
        <div class="row">
          <label>版本</label>
          <span class="value">{{ version || '0.1.0' }}</span>
        </div>
        <div class="row">
          <label>语言</label>
          <span class="value">简体中文</span>
        </div>
        <p class="hint">光束录推 BeamScreenPusher · 开源项目（MIT License）。采集由 C++ 原生模块完成，编码推流由 ffmpeg 完成。</p>
      </section>

      <footer class="footer">
        <span v-if="saved" class="saved-tip">✓ 已保存</span>
        <button class="btn primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
      </footer>
    </main>
  </div>
</template>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #app { height: 100%; }
body {
  font-family: 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
  background: #14171c; color: #e8ecf2; font-size: 14px;
  user-select: none;
}
</style>

<style scoped>
.settings { display: flex; height: 100%; }
.nav {
  width: 160px; flex: none; background: #1a1e26; border-right: 1px solid #262b34;
  padding: 16px 10px; display: flex; flex-direction: column; gap: 2px;
}
.nav-title { font-size: 13px; color: #8b93a3; padding: 0 10px 12px; font-weight: 600; }
.nav-item {
  padding: 9px 10px; border-radius: 6px; cursor: pointer; color: #b7becb; font-size: 13px;
}
.nav-item:hover { background: #222833; color: #e8ecf2; }
.nav-item.active { background: #2f6fed; color: #fff; }
.content { flex: 1; padding: 24px 28px; display: flex; flex-direction: column; overflow-y: auto; }
.panel { flex: 1; }
h2 { font-size: 16px; font-weight: 600; margin-bottom: 18px; color: #f1f4f9; }
.row { display: flex; align-items: center; margin-bottom: 16px; gap: 12px; }
.row label { width: 96px; flex: none; color: #aab2c0; }
select, input {
  background: #1d222b; border: 1px solid #2c333e; color: #e8ecf2;
  border-radius: 6px; padding: 7px 10px; font-size: 13px; outline: none; min-width: 240px;
}
select:focus, input:focus { border-color: #2f6fed; }
input.num { min-width: 80px; }
input.hotkey { min-width: 120px; font-family: Consolas, monospace; text-transform: uppercase; }
.value { color: #c6ccd6; }
.slider-wrap { display: flex; align-items: center; gap: 12px; flex: 1; }
.slider-wrap input[type='range'] { flex: 1; accent-color: #2f6fed; }
.slider-val { color: #8fd0ff; font-variant-numeric: tabular-nums; width: 52px; }
.switch-row label { width: 96px; }
.switch {
  width: 40px; height: 22px; border-radius: 11px; border: none; background: #2c333e;
  position: relative; cursor: pointer; transition: background 0.15s;
}
.switch.on { background: #2f6fed; }
.knob {
  position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; transition: left 0.15s;
}
.switch.on .knob { left: 21px; }
.hint { color: #7d8595; font-size: 12px; line-height: 1.7; margin-top: 4px; }
.footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 12px;
  padding-top: 18px; border-top: 1px solid #232832; margin-top: 8px;
}
.saved-tip { color: #4ade80; font-size: 13px; }
.btn {
  border: none; border-radius: 6px; padding: 8px 22px; font-size: 13px; cursor: pointer;
  background: #262c36; color: #c9d1de;
}
.btn.primary { background: #2f6fed; color: #fff; }
.btn.primary:hover { background: #3b7bfa; }
.btn.primary:disabled { opacity: 0.6; cursor: default; }
.placeholder { color: #8b93a3; padding: 40px; text-align: center; }
</style>
