# Local Video Tiler

A minimal Electron desktop app for building custom tiling layouts of local media
folders. Each tile can be assigned its own folder of downloaded videos or audio
files, then played independently inside the layout.

## Features

- Edit-mode-only layout changes so playback is not accidentally interrupted.
- Hover previews that show where a tile will split before you click.
- Left click splits a tile vertically; Shift + left click splits horizontally.
- Draggable split gutters for adjusting tile proportions.
- Optional visual grid and snap-to-grid splitting/resizing.
- Per-tile folder assignment with local media playback.
- Auto-hiding controls for a minimal viewing interface.
- Display spanning control that resizes the app window across all connected
  displays.

## Run locally

```sh
npm install
npm start
```

## Development checks

```sh
npm run check
```
