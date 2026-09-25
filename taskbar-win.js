'use strict';

const { execFile, execFileSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'scripts', 'win-taskbar.ps1');

function psArgs(mode, extra) {
  return ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Mode', mode].concat(extra || []);
}

function run(mode, extra) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve();
    execFile('powershell.exe', psArgs(mode, extra), { windowsHide: true }, () => resolve());
  });
}

/** Hide the primary taskbar and every secondary-monitor taskbar. */
function hideWindowsTaskbars() {
  return run('hide');
}

/** Put the taskbars back. Safe to call if they are already visible. */
function showWindowsTaskbars() {
  return run('show');
}

function showWindowsTaskbarsSync() {
  if (process.platform !== 'win32') return;
  try {
    execFileSync('powershell.exe', psArgs('show'), { windowsHide: true, timeout: 8000 });
  } catch (_) { /* ignore */ }
}

/**
 * Force the window over the taskbar. Electron's setBounds is clamped to the
 * work area; SetWindowPos with HWND_TOPMOST is not.
 * `bounds` is in DIP. `screen` is Electron's screen module.
 */
function pinOverTaskbar(win, bounds, screen) {
  if (process.platform !== 'win32' || !win || win.isDestroyed() || !bounds) return Promise.resolve();
  let px = bounds;
  try { px = screen.dipToScreenRect(win, bounds); } catch (_) { /* already pixels */ }
  const handle = win.getNativeWindowHandle();
  const hwnd = handle.length >= 8
    ? handle.readBigUInt64LE(0).toString()
    : String(handle.readUInt32LE(0));
  return run('pin', ['-Hwnd', hwnd, '-X', String(Math.round(px.x)), '-Y', String(Math.round(px.y)), '-W', String(Math.round(px.width)), '-H', String(Math.round(px.height))]);
}

module.exports = {
  hideWindowsTaskbars,
  showWindowsTaskbars,
  showWindowsTaskbarsSync,
  pinOverTaskbar
};
