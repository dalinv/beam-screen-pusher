// 光束录推 —— IPC 通道集中定义（架构设计 3.2：渲染层只经 spAPI 白名单通信）
export const IPC = {
  /** 应用版本 */
  AppGetVersion: 'app:get-version',
  /** 采集探测：取一帧并返回尺寸信息（M1 验证用） */
  CaptureProbe: 'capture:probe',
  /** 开始录制 */
  RecorderStart: 'recorder:start',
  /** 停止录制 */
  RecorderStop: 'recorder:stop',
  /** 暂停录制 */
  RecorderPause: 'recorder:pause',
  /** 恢复录制 */
  RecorderResume: 'recorder:resume',
  /** 查询录制状态 */
  RecorderGetState: 'recorder:get-state',
  /** 回看：导出最近 N 秒（标题栏按钮 / 快捷键 F9） */
  ReplaySave: 'replay:save',
  /** 回看：查询状态 */
  ReplayGetState: 'replay:get-state',
  /** 回看：导出成功事件（M → R，快捷键触发时渲染层也能收到） */
  ReplaySavedEvent: 'replay:saved',
  /** 推流：开始 */
  StreamStart: 'stream:start',
  /** 推流：停止 */
  StreamStop: 'stream:stop',
  /** 推流：查询状态 */
  StreamGetState: 'stream:get-state',
  /** 打开设置窗口 */
  OpenSettings: 'app:open-settings',
  /** 在文件管理器中显示文件（点击输出路径跳转） */
  AppRevealPath: 'app:reveal-path',
  /** 读取设置 */
  SettingsGet: 'settings:get',
  /** 保存设置 */
  SettingsSet: 'settings:set',
  /** 性能指标 */
  AppMetrics: 'app:metrics',
  /** 获取预览屏幕源（desktopCapturer） */
  PreviewGetSource: 'preview:get-source',
  /** 打开区域选择窗口 */
  RegionOpen: 'region:open',
  /** 确认区域（区域窗口确认后写入全局状态） */
  RegionConfirm: 'region:confirm',
  /** 取消区域选择 */
  RegionCancel: 'region:cancel',
  /** 查询当前采集区域 */
  RegionGetState: 'region:get-state',
  /** 区域变更事件（M→R 推送） */
  RegionChangedEvent: 'region:changed',
  /** 区域延迟生效提示（录制/推流进行中，M→R 推送） */
  RegionDeferredEvent: 'region:deferred'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
