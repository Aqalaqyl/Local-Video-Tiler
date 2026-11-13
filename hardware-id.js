'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const HARDWARE_ID_NAMESPACE = 'local-video-tiler/hardware-id/v1';

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000
    }).trim();
  } catch (_) {
    return '';
  }
}

function windowsMachineGuid() {
  const output = run('reg.exe', [
    'query',
    'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
    '/v',
    'MachineGuid'
  ]);
  const match = output.match(/MachineGuid\s+REG_\w+\s+(.+)$/im);
  if (match && match[1].trim()) return { source: 'windows-machine-guid', value: match[1].trim() };

  const uuid = run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(Get-CimInstance Win32_ComputerSystemProduct).UUID'
  ]).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (uuid) return { source: 'windows-system-uuid', value: uuid };
  return null;
}

function macPlatformUuid() {
  const output = run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
  const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/i);
  return match ? { source: 'mac-platform-uuid', value: match[1] } : null;
}

function linuxMachineId() {
  for (const filePath of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const value = fs.readFileSync(filePath, 'utf8').trim();
      if (value) return { source: 'linux-machine-id', value };
    } catch (_) { /* try the next standard path */ }
  }
  return null;
}

function readMachineIdentity(platform = process.platform) {
  if (platform === 'win32') return windowsMachineGuid();
  if (platform === 'darwin') return macPlatformUuid();
  if (platform === 'linux') return linuxMachineId();
  return null;
}

function hardwareIdFromRaw(rawIdentity) {
  const normalized = String(rawIdentity || '').trim().toUpperCase();
  if (!normalized) throw new Error('A stable machine identifier is unavailable');
  const digest = crypto
    .createHash('sha256')
    .update(HARDWARE_ID_NAMESPACE)
    .update('\0')
    .update(normalized)
    .digest('hex')
    .slice(0, 32)
    .toUpperCase();
  return 'LVT-' + digest.match(/.{1,4}/g).join('-');
}

function getHardwareIdentity() {
  const identity = readMachineIdentity();
  if (!identity || !identity.value) {
    const error = new Error(`Could not read a stable hardware identifier on ${os.platform()}`);
    error.code = 'HARDWARE_ID_UNAVAILABLE';
    throw error;
  }
  return {
    id: hardwareIdFromRaw(identity.value),
    source: identity.source
  };
}

function getHardwareId() {
  return getHardwareIdentity().id;
}

module.exports = {
  HARDWARE_ID_NAMESPACE,
  getHardwareId,
  getHardwareIdentity,
  hardwareIdFromRaw,
  readMachineIdentity
};
