# TileView

A local desktop media viewer with a tiling window manager-style layout. Split the screen into customizable tiles, assign folders of video files to each tile, and watch across one or all connected displays.

## Features

- **Tiling layouts** — Binary-split tree layout engine; click to split vertically, Shift+click for horizontal splits
- **Edit mode** — Layout changes are locked behind edit mode; hover previews show exactly where a split will land
- **Folder assignment** — Each tile can point at a folder; videos are listed and playable in-place
- **Multi-display** — Move the window to any display, or span fullscreen across all monitors
- **Minimal UI** — Toolbar auto-hides when idle; reappears on mouse movement or keyboard shortcuts
- **Grid & snap** — Optional alignment grid with configurable divisions; snap splits to grid lines

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `E` | Toggle edit mode |
| `G` | Toggle grid (edit mode) |
| `S` | Toggle snap (edit mode) |
| `F` | Toggle span-all-displays fullscreen |
| `Esc` | Exit edit mode or span fullscreen |

## Requirements

- Node.js 18+
- npm 9+

## Development

```bash
npm install
npm run electron:dev
```

## Build

```bash
npm run build
npm start          # run packaged electron locally
npm run electron:build   # create distributable
```

## Usage

1. Launch the app.
2. Press **Edit Layout** (or `E`) to enter edit mode.
3. Hover over a tile to preview a split; click for vertical, Shift+click for horizontal.
4. Exit edit mode and assign a media folder to each tile via the folder button.
5. Use the playlist button to pick videos, or let playback continue to the next file automatically.

Layouts and settings are saved automatically to your user data directory.
