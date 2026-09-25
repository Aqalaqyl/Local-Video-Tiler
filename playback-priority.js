'use strict';

/**
 * Keep video decode and compositing ahead of everything else on Windows.
 * The GPU process is still one process for every display; this raises that
 * process (and each display's renderer) to the high scheduling class and
 * turns off efficiency-mode throttling so unfocused screens stay at full rate.
 * Live ffmpeg transcodes are dropped to below-normal so they cannot take a
 * hardware decoder away from the tiles. Other platforms no-op.
 */

const HIGH_PRIORITY_CLASS = 0x00000080;
const BELOW_NORMAL_PRIORITY_CLASS = 0x00004000;
const PROCESS_SET_INFORMATION = 0x0200;
const PROCESS_QUERY_INFORMATION = 0x0400;
const PROCESS_POWER_THROTTLING = 4;
const PROCESS_POWER_THROTTLING_EXECUTION_SPEED = 0x1;
const GPU_SCHEDULING_HIGH = 4;

let kernel32 = null;
let gdi32 = null;
let ready = false;
let failed = false;

function winApi() {
  if (process.platform !== 'win32' || failed) return null;
  if (ready) return { kernel32, gdi32 };
  try {
    const koffi = require('koffi');
    kernel32 = koffi.load('kernel32.dll');
    kernel32.GetCurrentProcess = kernel32.func('void * __stdcall GetCurrentProcess()');
    kernel32.OpenProcess = kernel32.func('void * __stdcall OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)');
    kernel32.CloseHandle = kernel32.func('int __stdcall CloseHandle(void *hObject)');
    kernel32.SetPriorityClass = kernel32.func('int __stdcall SetPriorityClass(void *hProcess, uint32 dwPriorityClass)');
    kernel32.SetProcessInformation = kernel32.func('int __stdcall SetProcessInformation(void *hProcess, int ProcessInformationClass, void *ProcessInformation, uint32 ProcessInformationSize)');
    try {
      gdi32 = koffi.load('gdi32.dll');
      gdi32.D3DKMTSetProcessSchedulingPriorityClass = gdi32.func(
        'int __stdcall D3DKMTSetProcessSchedulingPriorityClass(void *hProcess, int priorityClass)'
      );
    } catch (_) {
      gdi32 = null;
    }
    ready = true;
    return { kernel32, gdi32 };
  } catch (_) {
    failed = true;
    return null;
  }
}

function disablePowerThrottling(handle) {
  const api = winApi();
  if (!api || !handle) return;
  const state = Buffer.alloc(12);
  state.writeUInt32LE(1, 0);
  state.writeUInt32LE(PROCESS_POWER_THROTTLING_EXECUTION_SPEED, 4);
  state.writeUInt32LE(0, 8);
  try {
    api.kernel32.SetProcessInformation(handle, PROCESS_POWER_THROTTLING, state, state.length);
  } catch (_) { /* ignore */ }
}

function setPriority(handle, priorityClass) {
  const api = winApi();
  if (!api || !handle) return;
  try { api.kernel32.SetPriorityClass(handle, priorityClass); } catch (_) { /* ignore */ }
  if (priorityClass !== HIGH_PRIORITY_CLASS) return;
  disablePowerThrottling(handle);
  if (!api.gdi32) return;
  try {
    api.gdi32.D3DKMTSetProcessSchedulingPriorityClass(handle, GPU_SCHEDULING_HIGH);
  } catch (_) { /* ignore */ }
}

function withProcess(pid, fn) {
  const api = winApi();
  if (!api || !pid) return;
  let handle = null;
  try {
    handle = api.kernel32.OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION, 0, pid >>> 0);
  } catch (_) {
    handle = null;
  }
  if (!handle) return;
  try { fn(handle); }
  finally {
    try { api.kernel32.CloseHandle(handle); } catch (_) { /* ignore */ }
  }
}

/** Browser, GPU, and every display renderer. Safe to call before app.ready. */
function raisePlaybackPriority() {
  const api = winApi();
  if (!api) return;
  try { setPriority(api.kernel32.GetCurrentProcess(), HIGH_PRIORITY_CLASS); } catch (_) { /* ignore */ }
  let metrics = [];
  try {
    const { app } = require('electron');
    if (app && app.isReady && app.isReady() && typeof app.getAppMetrics === 'function') {
      metrics = app.getAppMetrics() || [];
    }
  } catch (_) { /* ignore */ }
  for (const metric of metrics) {
    const type = String(metric && metric.type || '');
    if (type !== 'Browser' && type !== 'GPU' && type !== 'Tab' && type !== 'Utility') continue;
    withProcess(metric.pid, (handle) => setPriority(handle, HIGH_PRIORITY_CLASS));
  }
}

/** ffmpeg and other background helpers must not outrank video decode. */
function deprioritizeProcess(pid) {
  withProcess(pid, (handle) => setPriority(handle, BELOW_NORMAL_PRIORITY_CLASS));
}

module.exports = { raisePlaybackPriority, deprioritizeProcess };
