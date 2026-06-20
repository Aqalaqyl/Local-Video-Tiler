# Local Video Tiler

A local desktop application for viewing and listening to your downloaded video
files, arranged in a fully customizable, **tiling-window-manager style** layout.
Carve the screen into as many panes as you like, point each pane at a folder of
media, and let everything play side by side.

Built with [Electron](https://www.electronjs.org/) — everything runs locally,
nothing is uploaded anywhere.

## Features

- **Tiling layout engine** — the screen is a binary space-partition tree of
  tiles, just like a tiling window manager.
- **Edit mode (locked behind a toggle)** — splitting is only possible while edit
  mode is active, so normal viewing never gets disturbed.
  - **Always-on legend** — while editing, a legend pinned to the bottom of the
    screen spells out every gesture (click to split, Shift to flip the
    direction, drag to resize, ✕ to close), so you never have to guess.
  - **Live split preview** — while editing, the hovered tile shows exactly how
    it will be divided: the part that keeps the current content is tinted blue
    and labelled **“Keeps this tile · N%”**, the brand-new tile is shown as a
    hatched teal **“New empty tile · N%”** region, a glowing line marks the
    split, and a badge names the direction (vertical / horizontal). The split
    follows your cursor.
  - **Left click → vertical split** (left | right).
  - **Shift + left click → horizontal split** (top / bottom).
  - The split happens **at the cursor position**, so you choose the proportions
    as you click.
- **Effortless folder assignment** — give a tile a folder in whatever way is
  quickest: **drag a folder straight onto the tile** (it highlights with a
  “Drop folder to play here” cue), **double-click** the tile, or use the
  **📁 / Choose media folder…** button.
- **Random, never-ending playback** — each tile shuffles through the videos in
  its folder, picking a new random clip every time one ends and looping forever.
  A built-in watchdog keeps a video on screen at all times, recovering from
  unexpected stops or unplayable files, so a tile is **always playing**. Per-tile
  controls (play/pause, next/previous, seek, volume, mute) are still there when
  you want them.
- **Multiple display support** — detects every connected monitor.
  - **Fullscreen on the current display** (`F`).
  - **Span / fullscreen across ALL displays at once** (`A`).
  - When spanning every display, **each monitor gets its own control bar and
    edit indicator** anchored to that screen, so the UI is always within reach no
    matter which display you're looking at — no hunting across screens for the
    controls. You can keep splitting/editing tiles right across the whole
    multi-monitor canvas, and hot-plugging or rearranging monitors re-fits the
    span automatically.
- **Unmistakable edit indicator** — while editing, a pulsing accent frame, an
  **✏ EDIT MODE** badge and the controls legend stay on screen in **every** window
  mode (windowed, fullscreen, and across all displays), so you always know when a
  click will split a tile.
- **Minimal, auto-hiding interface** — the top bar, tile controls and even the
  mouse cursor fade away when you stop interacting, leaving a clean viewing
  surface. They reappear the moment you move the mouse.
- **Alignment grid** — toggle a grid of squares to lay tiles out neatly and
  symmetrically. The cell size is adjustable.
- **Snap to grid** — when enabled, splits and divider drags snap to the grid for
  perfectly aligned layouts.
- **Resizable dividers** — drag the divider between any two tiles to rebalance
  them (snaps to the grid when snap is on).
- **Layout persistence** — your layout, folder assignments and settings are
  remembered between sessions.

## Getting started

```bash
npm install
npm start
```

> The first `npm install` downloads the Electron runtime, which can take a
> little while.

## Controls

| Action | How |
| --- | --- |
| Toggle edit mode | `E` or the **Edit** button |
| Vertical split | Left-click a tile (in edit mode) |
| Horizontal split | `Shift` + left-click a tile (in edit mode) |
| Resize tiles | Drag the divider between them |
| Close / merge a tile | The **✕** button on the tile (visible in edit mode) |
| Assign a folder | Drag a folder onto a tile, **double-click** the tile, the **📁** button, or the *Choose media folder…* button |
| Play / pause focused tile | `Space` |
| Toggle alignment grid | `G` or the **Grid** button |
| Toggle snap to grid | `S` or the **Snap** button |
| Adjust grid cell size | The **Cell** slider |
| Reset layout | The **Reset** button |
| Fullscreen (current display) | `F` or the **Fullscreen** button |
| Fullscreen across ALL displays | `A` or the **All Displays** button |
| Exit edit mode | `Escape` |

## Supported formats

Playback uses the Chromium media stack, so well-supported containers/codecs such
as **MP4 (H.264/AAC)**, **WebM** and **Ogg** play reliably. Other extensions
(`.mkv`, `.avi`, `.mov`, `.wmv`, `.flv`, …) are listed and will play if the
underlying codec is supported by your system's Chromium build.

## Project structure

```
main.js        Electron main process: window, displays, fullscreen, IPC, folder reads
preload.js     Secure contextBridge API exposed to the renderer
src/index.html UI shell
src/styles.css Styling, auto-hide chrome, grid + preview visuals
src/renderer.js Tiling engine, edit mode, media playback, snap/grid, persistence
```

## License

MIT
