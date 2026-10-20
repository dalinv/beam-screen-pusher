// 设置窗口入口（M4）
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Settings from './Settings.vue'

createApp(Settings).use(createPinia()).mount('#app')
