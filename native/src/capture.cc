// 光束录推 BeamScreenPusher —— C++ 屏幕采集原生模块（Windows GDI BitBlt）
//
// M2：同步取帧，双缓冲 DIB section 零拷贝输出 BGRA 原始帧。
// TODO(M3)：独立采集线程 + 环形帧缓冲池（回看/推流并发消费需要），不阻塞主线程。
//
// 导出 API（对应架构设计 3.4）：
//   CaptureInit(region, fps) -> boolean   region: 'fullscreen' | {x,y,width,height}
//   CaptureNext()            -> Buffer    BGRA 原始帧（width*height*4 字节）
//   CaptureStop()            -> void
//   GetInfo()                -> { initialized, width, height, fps, x, y }
#include <napi.h>
#include <windows.h>
#include <timeapi.h>
#include <mutex>
#include <string>

namespace {

HDC g_screenDc = nullptr;  // 屏幕 DC（虚拟屏幕）
int g_x = 0, g_y = 0, g_w = 0, g_h = 0;
int g_fps = 30;

// 双缓冲 DIB section（M2 优化）：BitBlt 直接写入系统内存，避免 GetDIBits 拷贝
// 交付采用 Buffer::Copy（Electron 禁用外部缓冲区，见 CaptureNext）
struct DibBuffer {
  HDC dc = nullptr;             // 内存 DC
  HBITMAP bmp = nullptr;        // DIB section 位图
  HBITMAP oldBmp = nullptr;
  unsigned char* bits = nullptr;  // 顶向下 BGRA 内存
};
DibBuffer g_dib[2];
int g_poolIndex = 0;
std::mutex g_mtx;  // 防御性加锁，保证同一时刻单线程访问 GDI 资源

struct Region {
  int x, y, width, height;
};

bool IsInitialized() {
  return g_dib[0].bmp != nullptr && g_dib[1].bmp != nullptr && g_w > 0 && g_h > 0;
}

// 解析初始化参数：'fullscreen'（虚拟屏幕，多显示器全包）或 {x,y,width,height}
bool ParseRegion(const Napi::Value& region, Region& out, std::string& err) {
  if (region.IsString()) {
    std::string mode = region.As<Napi::String>().Utf8Value();
    if (mode == "fullscreen") {
      out.x = GetSystemMetrics(SM_XVIRTUALSCREEN);
      out.y = GetSystemMetrics(SM_YVIRTUALSCREEN);
      out.width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
      out.height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
      if (out.width <= 0 || out.height <= 0) {  // 极端情况回退主屏
        out.x = 0;
        out.y = 0;
        out.width = GetSystemMetrics(SM_CXSCREEN);
        out.height = GetSystemMetrics(SM_CYSCREEN);
      }
      return true;
    }
    err = "unknown region mode: " + mode;
    return false;
  }
  if (region.IsObject()) {
    Napi::Object o = region.As<Napi::Object>();
    out.x = o.Get("x").ToNumber().Int32Value();
    out.y = o.Get("y").ToNumber().Int32Value();
    out.width = o.Get("width").ToNumber().Int32Value();
    out.height = o.Get("height").ToNumber().Int32Value();
    if (out.width <= 0 || out.height <= 0 || out.width > 10000 || out.height > 10000) {
      err = "invalid region size: " + std::to_string(out.width) + "x" + std::to_string(out.height);
      return false;
    }
    return true;
  }
  err = "region must be 'fullscreen' or {x,y,width,height}";
  return false;
}

// 释放全部 GDI 资源（调用方需持有 g_mtx）
void CaptureStopInternal() {
  for (DibBuffer& db : g_dib) {
    if (db.dc && db.oldBmp) {
      SelectObject(db.dc, db.oldBmp);
    }
    if (db.bmp) {
      DeleteObject(db.bmp);
    }
    if (db.dc) {
      DeleteDC(db.dc);
    }
    db = DibBuffer{};
  }
  if (g_screenDc) {
    ReleaseDC(nullptr, g_screenDc);
  }
  g_screenDc = nullptr;
  g_x = g_y = g_w = g_h = 0;
  g_poolIndex = 0;
}

// 初始化（或按新参数重建缓冲）
Napi::Value CaptureInit(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> lock(g_mtx);

  if (info.Length() < 2) {
    Napi::TypeError::New(env, "CaptureInit(region, fps) missing arguments").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Region r{};
  std::string err;
  if (!ParseRegion(info[0], r, err)) {
    Napi::TypeError::New(env, err).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int fps = info[1].ToNumber().Int32Value();
  if (fps < 1 || fps > 240) {
    fps = 30;
  }

  // 参数未变化时复用已有缓冲
  if (IsInitialized() && g_x == r.x && g_y == r.y && g_w == r.width && g_h == r.height && g_fps == fps) {
    return Napi::Boolean::New(env, true);
  }

  CaptureStopInternal();

  g_screenDc = GetDC(nullptr);
  if (!g_screenDc) {
    Napi::Error::New(env, "GetDC failed: cannot get screen DC").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // 创建两个 DIB section（顶向下 32bpp BGRA），内存直接可读，免 GetDIBits 拷贝
  BITMAPINFO bmi{};
  bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  bmi.bmiHeader.biWidth = r.width;
  bmi.bmiHeader.biHeight = -r.height;
  bmi.bmiHeader.biPlanes = 1;
  bmi.bmiHeader.biBitCount = 32;
  bmi.bmiHeader.biCompression = BI_RGB;
  for (DibBuffer& db : g_dib) {
    db.dc = CreateCompatibleDC(g_screenDc);
    db.bmp = CreateDIBSection(g_screenDc, &bmi, DIB_RGB_COLORS, reinterpret_cast<void**>(&db.bits), nullptr, 0);
    if (!db.dc || !db.bmp) {
      const std::string msg = "CreateDIBSection failed, GLE=" + std::to_string(GetLastError());
      CaptureStopInternal();
      Napi::Error::New(env, msg).ThrowAsJavaScriptException();
      return env.Undefined();
    }
    db.oldBmp = static_cast<HBITMAP>(SelectObject(db.dc, db.bmp));
  }
  g_x = r.x;
  g_y = r.y;
  g_w = r.width;
  g_h = r.height;
  g_fps = fps;
  return Napi::Boolean::New(env, true);
}

// 抓取下一帧，返回 BGRA Buffer（width*height*4 字节）
Napi::Value CaptureNext(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> lock(g_mtx);

  if (!IsInitialized()) {
    Napi::Error::New(env, "capture not initialized, call CaptureInit first").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // 屏幕内容直接拷贝进 DIB section 内存（SRCCOPY：屏幕 DC 已是合成后的最终画面）
  DibBuffer& cur = g_dib[g_poolIndex];
  g_poolIndex ^= 1;
  if (!BitBlt(cur.dc, 0, 0, g_w, g_h, g_screenDc, g_x, g_y, SRCCOPY)) {
    const std::string msg = "BitBlt failed, GLE=" + std::to_string(GetLastError());
    Napi::Error::New(env, msg).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const size_t len = static_cast<size_t>(g_w) * g_h * 4;

  // 交付内部 Buffer（Copy）：Electron 默认禁用外部缓冲区（--no-allow-external-buffers，
  // Node 22+ 安全策略），Napi::Buffer::New(外部内存) 在 Electron 主进程会抛
  // "External buffers are not allowed" 导致 0 帧。Copy 每帧约 1ms 内存拷贝，
  // 远小于 BitBlt 开销，且 JS 侧可安全持有帧（无双缓冲覆盖约束）。
  return Napi::Buffer<unsigned char>::Copy(env, cur.bits, len);
}

// 停止采集，释放 GDI 资源
Napi::Value CaptureStop(const Napi::CallbackInfo& info) {
  std::lock_guard<std::mutex> lock(g_mtx);
  CaptureStopInternal();
  return info.Env().Undefined();
}

// 返回当前采集状态与参数
Napi::Value GetInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> lock(g_mtx);
  Napi::Object o = Napi::Object::New(env);
  o.Set("initialized", Napi::Boolean::New(env, IsInitialized()));
  o.Set("width", Napi::Number::New(env, g_w));
  o.Set("height", Napi::Number::New(env, g_h));
  o.Set("fps", Napi::Number::New(env, g_fps));
  o.Set("x", Napi::Number::New(env, g_x));
  o.Set("y", Napi::Number::New(env, g_y));
  return o;
}

}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  // 高精度系统计时（1ms）：Windows 默认 timer 分辨率 15.6ms 会使 JS setInterval
  // 帧率调度漂移（33ms 实际触发 ~46.8ms，实测录不到 30fps）。
  // 进程退出时系统自动恢复默认分辨率；采集工具常驻期间保持高精度。
  timeBeginPeriod(1);
  exports.Set("CaptureInit", Napi::Function::New(env, CaptureInit));
  exports.Set("CaptureNext", Napi::Function::New(env, CaptureNext));
  exports.Set("CaptureStop", Napi::Function::New(env, CaptureStop));
  exports.Set("GetInfo", Napi::Function::New(env, GetInfo));
  return exports;
}

NODE_API_MODULE(screen_capture, Init)
