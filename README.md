# Local Video Tiler

A desktop media viewer with a tiling window manager-style layout. Split your screen into customizable tiles, assign video folders to each tile, and watch across one or all connected displays.

## Features

- **Tiling splits** — Click a tile for a vertical split; hold **Shift** and click for a horizontal split
- **Drag to resize** — Drag split handles to adjust tile proportions; enable the grid to snap splits to neat divisions
- **Folder assignment** — Right-click or double-click a tile to assign a folder of video files
- **Multi-display** — Fullscreen on a chosen display or span all connected monitors
- **Layout preview** — Before entering fullscreen or all-display mode, a visual preview shows exactly how tiles will be arranged
- **Minimal UI** — Toolbar and hints auto-hide when idle; move the cursor to the top or bottom edge to reveal them

## Supported video formats

MP4, WebM, OGG, MOV, AVI, MKV, M4V, WMV, FLV

## Requirements

- Node.js 18+
- npm

## Install and run

```bash
npm install
npm start
```

## Controls

| Action | Input |
|--------|-------|
| Vertical split | Click tile |
| Horizontal split | Shift + click tile |
| Assign folder | Right-click tile → Assign video folder, or double-click tile |
| Next / previous video | Right-click tile |
| Toggle snap grid | **G** or Grid button |
| Fullscreen | **F11** or Fullscreen button |
| All displays | All Displays button |
| Exit fullscreen | **Esc** |
| Close tile | Right-click → Close tile |

## How it works

The layout is stored as a binary tree of splits (vertical or horizontal) and leaf tiles. Each leaf can hold an assigned folder; videos loop automatically. Layouts persist in local storage between sessions.
