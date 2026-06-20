#!/usr/bin/env node
import { spawn } from 'child_process';
import { buildSync } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function compileElectron() {
  buildSync({
    entryPoints: [
      path.join(root, 'electron/main.ts'),
      path.join(root, 'electron/preload.ts'),
    ],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outdir: path.join(root, 'dist-electron'),
    external: ['electron'],
    format: 'cjs',
    sourcemap: true,
  });
}

compileElectron();

const vite = spawn('npx', ['vite'], { cwd: root, stdio: 'inherit', shell: true });

let electronProc: ReturnType<typeof spawn> | null = null;

function startElectron() {
  compileElectron();
  if (electronProc) electronProc.kill();
  electronProc = spawn('npx', ['electron', '.'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  });
}

const http = await import('http');

function waitForVite(retries = 60) {
  return new Promise<void>((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const req = http.get('http://localhost:5173', (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (attempts >= retries) reject(new Error('Vite did not start'));
        else setTimeout(check, 500);
      });
    };
    check();
  });
}

waitForVite()
  .then(() => startElectron())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

process.on('SIGINT', () => {
  vite.kill();
  electronProc?.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  vite.kill();
  electronProc?.kill();
  process.exit(0);
});
