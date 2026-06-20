# Local Video Tiler

A desktop media viewer with a tiling window manager-style layout. Split your screen into customizable tiles, assign folders of video files to each tile, and watch across one or all connected displays.

## Features

- **Tiling layout editor** — Split tiles horizontally or vertically, drag split handles to resize
- **Grid snapping** — Toggle a grid overlay and snap splits to configurable columns/rows
- **Folder assignment** — Assign a folder of videos to each tile; videos auto-advance on end
- **Multi-display** — View on a single display or span all connected monitors
- **Split preview** — Bright tile borders and display boundary guides in fullscreen mode
- **Auto-hide UI** — Controls fade away during viewing; move the mouse to reveal them
- **Persistence** — Layouts are saved automatically

## Requirements

- Node.js 18+
- npm

On Linux, a display server (X11 or Wayland) is required for multi-monitor support.

## Install

```bash
npm install
```

## Development

```bash
npm run dev
```

This starts the Vite dev server and launches Electron.

## Production build

```bash
npm run build
npm start
```

## Usage

1. **Select a tile** — Click any tile in the layout
2. **Split** — Use `Split ↔` or `Split ↕` to divide the selected tile
3. **Resize** — Drag the split handles; enable **Grid** for snap-to-grid alignment
4. **Assign videos** — Click **Assign Folder** on a tile and choose a directory of video files
5. **Preview splits** — Toggle **Split Preview** to see tile boundaries before going fullscreen
6. **Go fullscreen** — Choose **Single Display** or **All Displays**, then click **Go Fullscreen**
7. **Exit** — Press `Esc` or move the mouse to the top and click **Exit Fullscreen**

### Supported video formats

`.mp4`, `.webm`, `.mkv`, `.avi`, `.mov`, `.m4v`, `.ogv`, `.wmv`, `.flv`

## Architecture

- **Electron** — Multi-window and multi-display management
- **React + TypeScript** — UI and layout state
- **Binary split tree** — Classic tiling WM layout model with draggable ratios

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Esc` | Exit fullscreen view mode |
