'use strict';

/**
 * Tiny Windows launcher compiled to "Local Video Tiler.exe".
 * Double-click next to the project files to install deps (first run) and start Electron.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function appRoot() {
  // When packaged with pkg, the .exe sits in the project root.
  if (process.pkg) return path.dirname(process.execPath);
  return path.join(__dirname, '..');
}

function exists(p) {
  try { return fs.existsSync(p); } catch (_) { return false; }
}

function fail(msg) {
  try {
    // Keep a console visible on failure when started by double-click.
    console.error(msg);
  } catch (_) { /* ignore */ }
  try {
    spawnSync('cmd.exe', ['/c', 'echo ' + msg.replace(/[&<>|^]/g, '^$&') + ' & pause'], {
      stdio: 'inherit',
      windowsHide: false
    });
  } catch (_) { /* ignore */ }
  process.exit(1);
}

const root = appRoot();
process.chdir(root);

const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

if (!exists(electronExe)) {
  console.log('First launch: installing dependencies...');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const install = spawnSync(npmCmd, ['install'], {
    cwd: root,
    stdio: 'inherit',
    shell: true
  });
  if (install.status !== 0) fail('npm install failed. Install Node.js from https://nodejs.org/ and try again.');
}

if (!exists(electronExe)) {
  fail('Electron runtime is missing. Run "npm install" in this folder, then try again.');
}

const child = spawn(electronExe, ['.'], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  windowsHide: false
});
child.unref();
process.exit(0);
