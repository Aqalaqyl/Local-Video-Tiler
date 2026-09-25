'use strict';

/**
 * Windows draws the taskbar in the topmost band, and it climbs back over a
 * window that only asks once. While All Displays is on, this module:
 *   - makes the span window a borderless topmost popup covering the virtual
 *     screen (taskbar area included),
 *   - drops every taskbar out of the topmost band and hides it,
 *   - asks the shell to auto-hide the taskbar,
 * and puts all of that back when the span ends.
 * Other platforms no-op.
 */

const SM_XVIRTUALSCREEN = 76;
const SM_YVIRTUALSCREEN = 77;
const SM_CXVIRTUALSCREEN = 78;
const SM_CYVIRTUALSCREEN = 79;

const SW_HIDE = 0;
const SW_SHOW = 5;

// Signed values. HWND_TOPMOST is (HWND)-1, HWND_NOTOPMOST is (HWND)-2,
// HWND_BOTTOM is (HWND)1. Pass numbers so they sign-extend; a uint64 -1
// does not fit in intptr and koffi drops it.
const HWND_BOTTOM = 1;
const HWND_TOPMOST = -1;
const HWND_NOTOPMOST = -2;

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const SWP_SHOWWINDOW = 0x0040;

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const GWLP_WNDPROC = -4;

// Windows asks for these before it will allow a size, then clamps the answer
// to the work area (above the taskbar). The span window has to answer with
// the full virtual screen or every monitor is shortened by the taskbar.
const WM_GETMINMAXINFO = 0x0024;
const WM_WINDOWPOSCHANGING = 0x0046;
const WM_NCCALCSIZE = 0x0083;

const WS_EX_TOPMOST = 0x00000008;
const WS_EX_DLGMODALFRAME = 0x00000001;
const WS_EX_WINDOWEDGE = 0x00000100;
const WS_EX_CLIENTEDGE = 0x00000200;
const WS_EX_STATICEDGE = 0x00020000;

const ABM_GETSTATE = 0x4;
const ABM_SETSTATE = 0xA;
const ABS_AUTOHIDE = 0x1;
const ABS_ALWAYSONTOP = 0x2;
const APPBAR_BYTES = 48;

let user32 = null;
let shellApi = null;
let koffiLib = null;
let secondaryEnum = null;
let savedStyle = null;
let savedExStyle = null;
let pinnedHwnd = null;
let savedAppBar = null;
let spanRect = null;
let origWndProc = null;
let wndProcCb = null;
let wndProcAddr = null;
let subclassHwnd = null;

function api() {
  if (process.platform !== 'win32') return null;
  if (user32) return user32;
  const koffi = require('koffi');
  koffiLib = koffi;
  const lib = koffi.load('user32.dll');
  const EnumProc = koffi.proto('bool __stdcall LvtEnumProc(intptr hwnd, intptr lParam)');
  const SpanProc = koffi.proto('intptr __stdcall LvtSpanProc(void *hwnd, uint msg, uintptr wParam, void *lParam)');
  user32 = {
    koffi,
    SpanProc,
    FindWindowW: lib.func('intptr __stdcall FindWindowW(const char16_t *lpClassName, const char16_t *lpWindowName)'),
    ShowWindow: lib.func('bool __stdcall ShowWindow(intptr hWnd, int nCmdShow)'),
    GetClassNameW: lib.func('int __stdcall GetClassNameW(intptr hWnd, void *buf, int max)'),
    EnumWindows: lib.func('bool __stdcall EnumWindows(LvtEnumProc *cb, intptr lParam)'),
    SetWindowPos: lib.func('bool __stdcall SetWindowPos(intptr hWnd, intptr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)'),
    GetSystemMetrics: lib.func('int __stdcall GetSystemMetrics(int nIndex)'),
    GetWindowLongPtrW: lib.func('intptr __stdcall GetWindowLongPtrW(intptr hWnd, int nIndex)'),
    SetWindowLongPtrW: lib.func('intptr __stdcall SetWindowLongPtrW(intptr hWnd, int nIndex, intptr dwNewLong)'),
    SetWindowLongPtrPtr: lib.func('intptr __stdcall SetWindowLongPtrW(intptr hWnd, int nIndex, void *dwNewLong)'),
    CallWindowProcW: lib.func('intptr __stdcall CallWindowProcW(intptr prev, void *hwnd, uint msg, uintptr wParam, void *lParam)'),
    EnumProc
  };
  return user32;
}

function shell32() {
  if (process.platform !== 'win32') return null;
  if (shellApi) return shellApi;
  try {
    const koffi = require('koffi');
    const lib = koffi.load('shell32.dll');
    shellApi = {
      SHAppBarMessage: lib.func('intptr __stdcall SHAppBarMessage(uint32 dwMessage, void *pData)')
    };
  } catch (err) {
    console.error('[Local Video Tiler] shell32', err && err.message ? err.message : err);
    shellApi = null;
  }
  return shellApi;
}

function asBig(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  return 0n;
}

function ptrBits(value) {
  return BigInt.asUintN(64, asBig(value));
}

function hwndOf(win) {
  if (!win || win.isDestroyed()) return 0n;
  const handle = win.getNativeWindowHandle();
  if (!handle || handle.length < 4) return 0n;
  // Signed. An unsigned read of a sign-extended HWND does not fit in intptr,
  // and koffi then drops the SetWindowPos call.
  // Unsigned bits. A negative BigInt is dropped by koffi and SetWindowPos no-ops.
  if (handle.length >= 8) return handle.readBigUInt64LE(0);
  return BigInt(handle.readUInt32LE(0));
}

function eachTaskbar(fn) {
  const u = api();
  if (!u) return;
  const primary = u.FindWindowW('Shell_TrayWnd', null);
  if (primary) fn(primary);
  secondaryEnum = (hwnd) => {
    const buf = Buffer.alloc(512);
    const n = u.GetClassNameW(hwnd, buf, 256);
    if (n > 0) {
      const name = buf.toString('utf16le').replace(/\0[\s\S]*$/, '');
      if (name === 'Shell_SecondaryTrayWnd') fn(hwnd);
    }
    return true;
  };
  u.EnumWindows(secondaryEnum, 0);
}

function appBarBuffer(hwnd, lParam) {
  const buf = Buffer.alloc(APPBAR_BYTES);
  buf.writeUInt32LE(APPBAR_BYTES, 0);
  const handle = typeof hwnd === 'bigint' ? hwnd : BigInt(hwnd || 0);
  buf.writeBigUInt64LE(handle, 8);
  buf.writeBigInt64LE(BigInt(Number(lParam) || 0), 40);
  return buf;
}

function pushTaskbarAutohide(hwnd) {
  const sh = shell32();
  if (!sh) return;
  try {
    if (savedAppBar == null) {
      const probe = Buffer.alloc(APPBAR_BYTES);
      probe.writeUInt32LE(APPBAR_BYTES, 0);
      const state = Number(sh.SHAppBarMessage(ABM_GETSTATE, probe));
      savedAppBar = Number.isFinite(state) ? (state & (ABS_AUTOHIDE | ABS_ALWAYSONTOP)) : ABS_ALWAYSONTOP;
    }
    // Re-apply every pin. The shell turns autohide back off and the work area
    // shrinks to the top of the taskbar, which is the cutoff on every screen.
    sh.SHAppBarMessage(ABM_SETSTATE, appBarBuffer(hwnd || 0, ABS_AUTOHIDE));
  } catch (err) {
    console.error('[Local Video Tiler] taskbar autohide', err && err.message ? err.message : err);
  }
}

function popTaskbarAutohide() {
  if (savedAppBar == null) return;
  const sh = shell32();
  const previous = savedAppBar;
  savedAppBar = null;
  if (!sh) return;
  try {
    sh.SHAppBarMessage(ABM_SETSTATE, appBarBuffer(0, previous));
  } catch (err) {
    console.error('[Local Video Tiler] taskbar restore', err && err.message ? err.message : err);
  }
}

function forceTopmostPopup(u, hwnd) {
  if (savedStyle == null) {
    savedStyle = u.GetWindowLongPtrW(hwnd, GWL_STYLE);
    savedExStyle = u.GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    pinnedHwnd = hwnd;
  }
  const caption = 0x00C00000n | 0x00040000n | 0x00800000n | 0x00400000n | 0x00080000n | 0x00020000n | 0x00010000n;
  // Build with BigInt. JS `|` sign-wraps 0x80000000 and would drop WS_POPUP.
  const popup = 0x80000000n | 0x10000000n | 0x02000000n | 0x04000000n;
  const style = (asBig(savedStyle) & ~caption) | popup;
  const exStrip = BigInt(WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE);
  const ex = (asBig(savedExStyle) & ~exStrip) | BigInt(WS_EX_TOPMOST);
  u.SetWindowLongPtrW(hwnd, GWL_STYLE, style);
  u.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
}

function restorePinnedStyle() {
  const u = api();
  if (!u || savedStyle == null || pinnedHwnd == null) {
    savedStyle = null;
    savedExStyle = null;
    pinnedHwnd = null;
    return;
  }
  const hwnd = pinnedHwnd;
  const style = savedStyle;
  const ex = savedExStyle;
  savedStyle = null;
  savedExStyle = null;
  pinnedHwnd = null;
  try {
    u.SetWindowLongPtrW(hwnd, GWL_STYLE, asBig(style));
    u.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, asBig(ex));
    u.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED);
  } catch (_) { /* window already gone */ }
}

function demoteTaskbars() {
  const u = api();
  if (!u) return;
  const flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
  eachTaskbar((hwnd) => {
    try {
      u.ShowWindow(hwnd, SW_HIDE);
      u.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, flags);
      u.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, flags);
    } catch (_) { /* ignore a tray that closed mid-enum */ }
  });
}

function restoreTaskbars() {
  const u = api();
  if (!u) return;
  const flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW;
  eachTaskbar((hwnd) => {
    try {
      u.ShowWindow(hwnd, SW_SHOW);
      u.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, flags);
    } catch (_) { /* ignore */ }
  });
}

/** Full virtual desktop in physical pixels, taskbars included. */
function virtualScreenRect() {
  const u = api();
  if (!u) return null;
  const x = u.GetSystemMetrics(SM_XVIRTUALSCREEN);
  const y = u.GetSystemMetrics(SM_YVIRTUALSCREEN);
  const w = u.GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const h = u.GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (!(w > 0 && h > 0)) return null;
  return { x, y, w, h };
}

function preferredRect(screenRect) {
  const metrics = virtualScreenRect();
  const preferred = screenRect && screenRect.width > 0 && screenRect.height > 0
    ? {
      x: Math.round(screenRect.x),
      y: Math.round(screenRect.y),
      w: Math.round(screenRect.width),
      h: Math.round(screenRect.height)
    }
    : null;
  if (!preferred) return metrics;
  if (!metrics) return preferred;
  const area = (r) => Math.abs(r.w * r.h);
  const pa = area(preferred);
  const ma = area(metrics);
  // Disagreeing by a lot means one value is still in DIP. Trust Electron.
  if (pa > 0 && ma > 0 && (Math.max(pa, ma) / Math.min(pa, ma)) > 1.25) return preferred;
  const x = Math.min(preferred.x, metrics.x);
  const y = Math.min(preferred.y, metrics.y);
  const right = Math.max(preferred.x + preferred.w, metrics.x + metrics.w);
  const bottom = Math.max(preferred.y + preferred.h, metrics.y + metrics.h);
  return { x, y, w: right - x, h: bottom - y };
}

function writeI32(ptr, offset, value) {
  koffiLib.encode(ptr, offset, 'int32', value | 0);
}

function readU32(ptr, offset) {
  return koffiLib.decode(ptr, offset, 'uint32') >>> 0;
}

function callOrigProc(hwnd, msg, wParam, lParam) {
  const u = api();
  if (!u || origWndProc == null) return 0;
  if (wndProcAddr != null && ptrBits(origWndProc) === wndProcAddr) return 0;
  return u.CallWindowProcW(asBig(origWndProc), hwnd, msg, wParam, lParam);
}

function msgNum(msg) {
  return typeof msg === 'bigint' ? Number(msg) : msg;
}

/**
 * Runs on the window thread for every message while spanning. Anything other
 * than the size messages is forwarded immediately.
 */
function onSpanWndProc(hwnd, msg, wParam, lParam) {
  const m = msgNum(msg);
  if (!spanRect || (m !== WM_GETMINMAXINFO && m !== WM_WINDOWPOSCHANGING && m !== WM_NCCALCSIZE)) {
    return callOrigProc(hwnd, msg, wParam, lParam);
  }
  // Keep the page itself full-bleed. The default handler insets the client
  // to the work area, which is the gap the taskbar sits in.
  if (m === WM_NCCALCSIZE) {
    if (!Number(wParam)) return callOrigProc(hwnd, msg, wParam, lParam);
    let left = 0;
    let top = 0;
    let right = 0;
    let bottom = 0;
    try {
      left = koffiLib.decode(lParam, 0, 'int32');
      top = koffiLib.decode(lParam, 4, 'int32');
      right = koffiLib.decode(lParam, 8, 'int32');
      bottom = koffiLib.decode(lParam, 12, 'int32');
    } catch (_) {
      return callOrigProc(hwnd, msg, wParam, lParam);
    }
    callOrigProc(hwnd, msg, wParam, lParam);
    try {
      writeI32(lParam, 0, left);
      writeI32(lParam, 4, top);
      writeI32(lParam, 8, right);
      writeI32(lParam, 12, bottom);
    } catch (err) {
      console.error('[Local Video Tiler] span client', err && err.message ? err.message : err);
    }
    return 0;
  }
  const ret = callOrigProc(hwnd, msg, wParam, lParam);
  const rect = spanRect;
  try {
    if (m === WM_GETMINMAXINFO) {
      // ptMaxSize, ptMaxPosition, ptMaxTrackSize. Same layout on x64: no pointers.
      writeI32(lParam, 8, rect.w);
      writeI32(lParam, 12, rect.h);
      writeI32(lParam, 16, rect.x);
      writeI32(lParam, 20, rect.y);
      writeI32(lParam, 32, rect.w);
      writeI32(lParam, 36, rect.h);
    } else {
      // WINDOWPOS is x64: x,y,cx,cy start at byte 16. Leave z-order-only updates alone.
      const flags = readU32(lParam, 32);
      if ((flags & SWP_NOMOVE) === 0) {
        writeI32(lParam, 16, rect.x);
        writeI32(lParam, 20, rect.y);
      }
      if ((flags & SWP_NOSIZE) === 0) {
        writeI32(lParam, 24, rect.w);
        writeI32(lParam, 28, rect.h);
      }
    }
  } catch (err) {
    console.error('[Local Video Tiler] span size', err && err.message ? err.message : err);
  }
  return ret;
}

function installSpanClamp(hwnd) {
  const u = api();
  if (!u || !hwnd) return;
  if (!wndProcCb) {
    wndProcCb = koffiLib.register(onSpanWndProc, koffiLib.pointer(u.SpanProc));
    try { wndProcAddr = ptrBits(koffiLib.address(wndProcCb)); } catch (_) { wndProcAddr = null; }
  }
  const current = ptrBits(u.GetWindowLongPtrW(hwnd, GWLP_WNDPROC));
  if (wndProcAddr != null && current === wndProcAddr) {
    subclassHwnd = hwnd;
    return;
  }
  if (subclassHwnd === hwnd && wndProcAddr == null) return;
  // Chain to whatever is installed now (Chromium, or a proc it replaced us with).
  if (current !== 0n) origWndProc = current;
  u.SetWindowLongPtrPtr(hwnd, GWLP_WNDPROC, wndProcCb);
  subclassHwnd = hwnd;
}

function removeSpanClamp() {
  spanRect = null;
  const u = api();
  const hwnd = subclassHwnd;
  const prev = origWndProc;
  subclassHwnd = null;
  origWndProc = null;
  if (u && hwnd && prev != null) {
    try {
      const current = ptrBits(u.GetWindowLongPtrW(hwnd, GWLP_WNDPROC));
      if (wndProcAddr == null || current === wndProcAddr) {
        u.SetWindowLongPtrW(hwnd, GWLP_WNDPROC, asBig(prev));
      }
    } catch (_) { /* window already gone */ }
  }
  if (wndProcCb) {
    const cb = wndProcCb;
    wndProcCb = null;
    wndProcAddr = null;
    try { koffiLib.unregister(cb); } catch (_) { /* ignore */ }
  }
}

/**
 * Keep `win` above every taskbar. `screenRect` is the virtual screen in
 * physical pixels ({x, y, width, height}); omit it to only fix z-order.
 * `activate` steals foreground. The repeater passes false so clicks keep working.
 */
function pinOverTaskbar(win, screenRect, activate) {
  const u = api();
  if (!u || !win || win.isDestroyed()) return;
  const hwnd = hwndOf(win);
  if (!hwnd) return;
  try {
    // Style changes and autohide are for the multi-monitor wall. A single
    // display already uses OS fullscreen, and rewriting its style drops that.
    if (screenRect) {
      pushTaskbarAutohide(hwnd);
      try { forceTopmostPopup(u, hwnd); } catch (err) {
        console.error('[Local Video Tiler] span style', err && err.message ? err.message : err);
      }
    }
    demoteTaskbars();
    const rect = screenRect ? preferredRect(screenRect) : null;
    if (rect) {
      spanRect = rect;
      installSpanClamp(hwnd);
    }
    const activateBit = activate ? 0 : SWP_NOACTIVATE;
    if (rect) {
      u.SetWindowPos(
        hwnd,
        HWND_TOPMOST,
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        SWP_SHOWWINDOW | SWP_FRAMECHANGED | activateBit
      );
    }
    // Z-order again after the move. The shell re-tops the taskbar in between.
    u.SetWindowPos(
      hwnd,
      HWND_TOPMOST,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | activateBit
    );
    demoteTaskbars();
  } catch (err) {
    console.error('[Local Video Tiler] span pin', err && err.message ? err.message : err);
  }
}

function hideWindowsTaskbars() {
  pushTaskbarAutohide();
  demoteTaskbars();
}

function showWindowsTaskbars() {
  removeSpanClamp();
  popTaskbarAutohide();
  restorePinnedStyle();
  restoreTaskbars();
}

function showWindowsTaskbarsSync() {
  showWindowsTaskbars();
}

module.exports = {
  hideWindowsTaskbars,
  showWindowsTaskbars,
  showWindowsTaskbarsSync,
  pinOverTaskbar,
  virtualScreenRect
};
