'use strict';

/**
 * Windows installer + launcher for Local Video Tiler.
 *
 * - If the app is already installed → launch it.
 * - Otherwise install prerequisites (Node.js deps / Electron runtime), copy the
 *   app into %LOCALAPPDATA%\Local Video Tiler, create shortcuts, then launch.
 *
 * Build with: npm run launcher:win  →  "Local Video Tiler.exe"
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PRODUCT = 'Local Video Tiler';
const APP_EXE_NAME = 'Local Video Tiler.exe';

function exists(p) {
  try { return fs.existsSync(p); } catch (_) { return false; }
}

function appRoot() {
  if (process.pkg) return path.dirname(process.execPath);
  return path.join(__dirname, '..');
}

function installDir() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, PRODUCT);
}

function installedAppExe(dir) {
  return path.join(dir, APP_EXE_NAME);
}

/** electron-builder per-user default install location */
function builderInstallExe() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'Programs', PRODUCT, APP_EXE_NAME);
}

function fail(msg) {
  console.error(msg);
  try {
    spawnSync(
      'cmd.exe',
      ['/c', 'echo.' + ' & echo ' + String(msg).replace(/[&<>|^]/g, '^$&') + ' & echo. & pause'],
      { stdio: 'inherit', windowsHide: false }
    );
  } catch (_) { /* ignore */ }
  process.exit(1);
}

function log(msg) {
  console.log(msg);
}

function which(cmd) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(checker, [cmd], { encoding: 'utf8', shell: true });
  return r.status === 0;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    windowsHide: false,
    ...opts
  });
  return r.status === 0;
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function writeInstallMarker(dir) {
  fs.writeFileSync(
    path.join(dir, 'install.json'),
    JSON.stringify({ product: PRODUCT, installedAt: new Date().toISOString(), version: '1.0.0' }, null, 2)
  );
}

function createShortcut(lnkPath, target, args, workDir, icon) {
  const ps = [
    `$ws = New-Object -ComObject WScript.Shell`,
    `$s = $ws.CreateShortcut('${lnkPath.replace(/'/g, "''")}')`,
    `$s.TargetPath = '${target.replace(/'/g, "''")}'`,
    args != null && args !== '' ? `$s.Arguments = '${String(args).replace(/'/g, "''")}'` : `$s.Arguments = ''`,
    `$s.WorkingDirectory = '${workDir.replace(/'/g, "''")}'`,
    icon ? `$s.IconLocation = '${icon.replace(/'/g, "''")}'` : '',
    `$s.Save()`
  ].filter(Boolean).join('; ');
  spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore', windowsHide: true });
}

function createShortcuts(appExe, dir) {
  const programs = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs'
  );
  const desktop = path.join(os.homedir(), 'Desktop');
  try { fs.mkdirSync(programs, { recursive: true }); } catch (_) { /* ignore */ }
  createShortcut(path.join(programs, PRODUCT + '.lnk'), appExe, '', dir, appExe);
  createShortcut(path.join(desktop, PRODUCT + '.lnk'), appExe, '', dir, appExe);
}

function launch(exe, cwd) {
  const child = spawn(exe, [], {
    cwd: cwd || path.dirname(exe),
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();
}

function findExistingInstall() {
  const candidates = [
    installedAppExe(installDir()),
    builderInstallExe()
  ];
  for (const exe of candidates) {
    if (exists(exe)) return exe;
  }
  return null;
}

/** Copy a prebuilt electron-builder win-unpacked tree into the install dir. */
function installFromUnpacked(unpackedDir, dest) {
  log('Installing Local Video Tiler...');
  if (exists(dest)) {
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
  copyRecursive(unpackedDir, dest);
  const exe = installedAppExe(dest);
  if (!exists(exe)) {
    // electron-builder may leave electron.exe before rename in odd layouts
    const electron = path.join(dest, 'electron.exe');
    if (exists(electron)) fs.renameSync(electron, exe);
  }
  if (!exists(exe)) fail('Install failed: application executable not found after copy.');
  writeInstallMarker(dest);
  createShortcuts(exe, dest);
  return exe;
}

/**
 * Build a per-user install from the source tree:
 * 1) ensure Node.js + npm install (Electron runtime)
 * 2) assemble Electron dist + app files under LocalAppData
 */
function installFromSource(root, dest) {
  log('Installing prerequisites and Local Video Tiler...');
  log('');

  if (!which('node') || !which('npm')) {
    fail(
      'Node.js is required for the first-time install.\n' +
      'Download and install it from https://nodejs.org/ then run this again.\n' +
      '(Choose the LTS version.)'
    );
  }

  const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
  if (!exists(path.join(electronDist, 'electron.exe'))) {
    log('Downloading Electron and project dependencies (first install only)...');
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    if (!run(npmCmd, ['install'], { cwd: root })) {
      fail('npm install failed. Check your internet connection and try again.');
    }
  }

  if (!exists(path.join(electronDist, 'electron.exe'))) {
    fail('Electron runtime is still missing after npm install.');
  }

  log('Copying application files...');
  if (exists(dest)) {
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
  copyRecursive(electronDist, dest);

  const electronExe = path.join(dest, 'electron.exe');
  const appExe = installedAppExe(dest);
  if (exists(electronExe)) {
    try { fs.renameSync(electronExe, appExe); } catch (_) {
      fs.copyFileSync(electronExe, appExe);
    }
  }

  const appDir = path.join(dest, 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const name of ['main.js', 'preload.js', 'package.json']) {
    fs.copyFileSync(path.join(root, name), path.join(appDir, name));
  }
  copyRecursive(path.join(root, 'src'), path.join(appDir, 'src'));

  // Slim package.json for the installed app (runtime only).
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
    const slim = {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      main: pkg.main,
      author: pkg.author,
      license: pkg.license
    };
    fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(slim, null, 2));
  } catch (_) { /* ignore */ }

  if (!exists(appExe)) fail('Install failed: could not create ' + APP_EXE_NAME);
  writeInstallMarker(dest);
  createShortcuts(appExe, dest);
  log('');
  log('Installed to: ' + dest);
  log('Desktop and Start Menu shortcuts were created.');
  return appExe;
}

function findUnpackedNear(root) {
  const candidates = [
    path.join(root, 'dist', 'win-unpacked'),
    path.join(root, 'win-unpacked'),
    path.join(path.dirname(root), 'win-unpacked')
  ];
  for (const dir of candidates) {
    if (exists(path.join(dir, APP_EXE_NAME)) || exists(path.join(dir, 'electron.exe'))) {
      return dir;
    }
  }
  return null;
}

function main() {
  const root = appRoot();
  const dest = installDir();

  const existing = findExistingInstall();
  if (existing) {
    launch(existing, path.dirname(existing));
    process.exit(0);
  }

  log('Local Video Tiler is not installed yet.');
  log('Running first-time setup...');
  log('');

  let appExe = null;
  const unpacked = findUnpackedNear(root);
  if (unpacked) {
    appExe = installFromUnpacked(unpacked, dest);
  } else if (exists(path.join(root, 'main.js')) && exists(path.join(root, 'package.json'))) {
    appExe = installFromSource(root, dest);
  } else {
    fail(
      'Could not find application files to install.\n' +
      'Ship this exe next to the win-unpacked folder from:\n' +
      '  npm run dist:win\n' +
      '(or keep the project layout after that build).'
    );
  }

  log('');
  log('Launching Local Video Tiler...');
  launch(appExe, path.dirname(appExe));
  process.exit(0);
}

main();
