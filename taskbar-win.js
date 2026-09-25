'use strict';

/**
 * Windows keeps normal windows in the work area, above the taskbar. Real
 * fullscreen uses the monitor rectangle instead. This does the same for the
 * whole virtual screen: one window, every display, taskbar included.
 * Other platforms no-op; Electron bounds cover the panel there.
 */

const SM_XVIRTUALSCREEN = 76;
const SM_YVIRTUALSCREEN = 77;
const SM_CXVIRTUALSCREEN = 78;
const SM_CYVIRTUALSCREEN = 79;
const SW_HIDE = 0;
const SW_SHOW = 5;
const HWND_TOPMOST = -1;
const SWP_SHOWWINDOW = 0x0040;
const SWP_FRAMECHANGED = 0x0020;

let user32 = null;
let secondaryEnum = null;

function api() {
  if (process.platform !== 'win32') return null;
  if (user32) return user32;
  const koffi = require('koffi');
  const lib = koffi.load('user32.dll');
  const EnumProc = koffi.proto('bool __stdcall LvtEnumProc(intptr hwnd, intptr lParam)');
  user32 = {
    koffi,
    FindWindowW: lib.func('intptr __stdcall FindWindowW(str16 lpClassName, str16 lpWindowName)'),
    ShowWindow: lib.func('bool __stdcall ShowWindow(intptr hWnd, int nCmdShow)'),
    GetClassNameW: lib.func('int __stdcall GetClassNameW(intptr hWnd, void *buf, int max)'),
    EnumWindows: lib.func('bool __stdcall EnumWindows(LvtEnumProc *cb, intptr lParam)'),
    SetWindowPos: lib.func('bool __stdcall SetWindowPos(intptr hWnd, intptr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)'),
    GetSystemMetrics: lib.func('int __stdcall GetSystemMetrics(int nIndex)'),
    EnumProc
  };
  return user32;
}

function hwndOf(win) {
  const handle = win.getNativeWindowHandle();
  if (handle.length >= 8) return handle.readBigUInt64LE(0);
  return BigInt(handle.readUInt32LE(0));
}

function eachSecondaryTaskbar(cmd) {
  const u = api();
  if (!u) return;
  // Keep the callback alive for the duration of EnumWindows (transient).
  secondaryEnum = (hwnd) => {
    const buf = Buffer.alloc(512);
    u.GetClassNameW(hwnd, buf, 256);
    const name = buf.toString('utf16le').replace(/\0[\s\S]*$/, '');
    if (name === 'Shell_SecondaryTrayWnd') u.ShowWindow(hwnd, cmd);
    return true;
  };
  u.EnumWindows(secondaryEnum, 0);
}

function setTaskbars(cmd) {
  const u = api();
  if (!u) return;
  try {
    const primary = u.FindWindowW('Shell_TrayWnd', null);
    if (primary) u.ShowWindow(primary, cmd);
    eachSecondaryTaskbar(cmd);
  } catch (err) {
    console.error('[Local Video Tiler] taskbar', err && err.message ? err.message : err);
  }
}

function hideWindowsTaskbars() {
  setTaskbars(SW_HIDE);
  return Promise.resolve();
}

function showWindowsTaskbars() {
  setTaskbars(SW_SHOW);
  return Promise.resolve();
}

function showWindowsTaskbarsSync() {
  setTaskbars(SW_SHOW);
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

/**
 * Place the window on the entire virtual screen, above the taskbar.
 * Does not use Electron setBounds, which Windows clamps to the work area.
 */
function pinOverTaskbar(win) {
  const u = api();
  if (!u || !win || win.isDestroyed()) return Promise.resolve();
  const rect = virtualScreenRect();
  if (!rect) return Promise.resolve();
  try {
    hideWindowsTaskbars();
    u.SetWindowPos(hwndOf(win), HWND_TOPMOST, rect.x, rect.y, rect.w, rect.h, SWP_SHOWWINDOW | SWP_FRAMECHANGED);
  } catch (err) {
    console.error('[Local Video Tiler] span pin', err && err.message ? err.message : err);
  }
  return Promise.resolve();
}

module.exports = {
  hideWindowsTaskbars,
  showWindowsTaskbars,
  showWindowsTaskbarsSync,
  pinOverTaskbar,
  virtualScreenRect
};
