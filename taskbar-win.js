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
let secondaryEnum = null;
let savedStyle = null;
let savedExStyle = null;
let pinnedHwnd = null;
let savedAppBar = null;

function api() {
  if (process.platform !== 'win32') return null;
  if (user32) return user32;
  const koffi = require('koffi');
  const lib = koffi.load('user32.dll');
  const EnumProc = koffi.proto('bool __stdcall LvtEnumProc(intptr hwnd, intptr lParam)');
  user32 = {
    FindWindowW: lib.func('intptr __stdcall FindWindowW(const char16_t *lpClassName, const char16_t *lpWindowName)'),
    ShowWindow: lib.func('bool __stdcall ShowWindow(intptr hWnd, int nCmdShow)'),
    GetClassNameW: lib.func('int __stdcall GetClassNameW(intptr hWnd, void *buf, int max)'),
    EnumWindows: lib.func('bool __stdcall EnumWindows(LvtEnumProc *cb, intptr lParam)'),
    SetWindowPos: lib.func('bool __stdcall SetWindowPos(intptr hWnd, intptr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)'),
    GetSystemMetrics: lib.func('int __stdcall GetSystemMetrics(int nIndex)'),
    GetWindowLongPtrW: lib.func('intptr __stdcall GetWindowLongPtrW(intptr hWnd, int nIndex)'),
    SetWindowLongPtrW: lib.func('intptr __stdcall SetWindowLongPtrW(intptr hWnd, int nIndex, intptr dwNewLong)'),
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

function hwndOf(win) {
  if (!win || win.isDestroyed()) return 0n;
  const handle = win.getNativeWindowHandle();
  if (!handle || handle.length < 4) return 0n;
  // Signed. An unsigned read of a sign-extended HWND does not fit in intptr,
  // and koffi then drops the SetWindowPos call.
  if (handle.length >= 8) return handle.readBigInt64LE(0);
  return BigInt(handle.readInt32LE(0));
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

function appBarBuffer(lParam) {
  const buf = Buffer.alloc(APPBAR_BYTES);
  buf.writeUInt32LE(APPBAR_BYTES, 0);
  buf.writeBigInt64LE(BigInt(Number(lParam) || 0), 40);
  return buf;
}

function pushTaskbarAutohide() {
  const sh = shell32();
  if (!sh || savedAppBar != null) return;
  try {
    const probe = Buffer.alloc(APPBAR_BYTES);
    probe.writeUInt32LE(APPBAR_BYTES, 0);
    const state = Number(sh.SHAppBarMessage(ABM_GETSTATE, probe));
    savedAppBar = state & (ABS_AUTOHIDE | ABS_ALWAYSONTOP);
    sh.SHAppBarMessage(ABM_SETSTATE, appBarBuffer(ABS_AUTOHIDE));
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
    sh.SHAppBarMessage(ABM_SETSTATE, appBarBuffer(previous));
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
      pushTaskbarAutohide();
      try { forceTopmostPopup(u, hwnd); } catch (err) {
        console.error('[Local Video Tiler] span style', err && err.message ? err.message : err);
      }
    }
    demoteTaskbars();
    const rect = screenRect ? preferredRect(screenRect) : null;
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
