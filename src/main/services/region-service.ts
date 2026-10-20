// 光束录推 —— 采集区域全局状态（M4：区域选择窗口确认后更新；录制/回看/推流共用）
import type { CaptureRegion } from '../../shared/types'

let region: CaptureRegion = 'fullscreen'

export function getRegion(): CaptureRegion {
  return region
}

export function setRegion(r: CaptureRegion): void {
  region = r
}
