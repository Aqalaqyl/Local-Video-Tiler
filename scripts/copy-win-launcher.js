'use strict';

/** Copy Local Video Tiler.exe into dist/ next to win-unpacked for shipping. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'Local Video Tiler.exe');
const distDir = path.join(root, 'dist');
const dest = path.join(distDir, 'Local Video Tiler.exe');

if (!fs.existsSync(src)) {
  console.error('Local Video Tiler.exe not found — run launcher:win first.');
  process.exit(1);
}
fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('Copied installer/launcher →', dest);
