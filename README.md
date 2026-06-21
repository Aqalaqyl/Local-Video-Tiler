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
  - **Live split preview** — while editing, the hovered tile shows exactly how
    it will be divided: the part that keeps the current content is tinted blue,
    the brand-new tile is shown as a hatched teal region, a glowing line marks
    the split, each side is labelled with its resulting percentage, and a badge
    names the direction (vertical / horizontal). The split follows your cursor.
  - **Left click → vertical split** (left | right).
  - **Shift + left click → horizontal split** (top / bottom).
  - The split happens **at the cursor position**, so you choose the proportions
    as you click.
  - You can split **any** tile this way — including brand-new, folder-less tiles.
  - **Always-visible boundaries** — tile borders and the dividers between them
    are clearly drawn (and glow in the accent colour while editing) so you can
    always see how the surface has been divided.
- **Per-tile media folders** — assign any folder to a tile and it becomes a
  playlist of the video files inside it, with play/pause, next/previous, seek,
  volume and mute controls.
  - **Random / shuffle playback** — a tile starts on a random clip and, when a
    clip finishes, automatically shuffles to another random clip from its folder.
    (Next / Previous still step through in order for manual control.)
  - **Per-tile loop** (🔁) — keep the current video on screen by repeating it.
    Loop is independent per tile, so one pane can hold on a clip while the others
    keep shuffling.
- **Multiple display support** — detects every connected monitor.
  - **Fullscreen on the current display** (`F`).
  - **Fullscreen across ALL displays at once** (`A`) — each monitor gets its own
    **real OS fullscreen window**, so every screen is genuinely fullscreen and
    **covers the taskbar / dock / menu bar**. The single tiling canvas is spread
    across the union of all monitors and each window shows just its own slice, so
    a tile (or a "Tile to Displays" layout) fills the screen it belongs to.
    - Your **primary** display keeps the top control bar.
    - **Every** display is a live editor — move the cursor to any screen and
      split / resize / delete tiles there; the alignment grid spans all monitors
      and edits sync instantly across the whole wall.
    - Hot-plugging or rearranging monitors re-fits the wall automatically.
  - When spanning every display, the control bar and edit tools are **pinned to
    your primary monitor** so they're always fully visible (never stranded in a
    dead zone between screens), and you can keep splitting/editing tiles right
    across the whole multi-monitor canvas. Hot-plugging or rearranging monitors
    re-fits the span automatically.
- **Screen-split guide** — an easy-to-see overlay that shows **exactly how the
  canvas maps onto your physical screens**. Each monitor is outlined with a
  glowing, labelled region (resolution + a ★ on your primary display) so you
  always know where one display ends and the next begins.
  - **Auto-appears** the moment you span all displays, and can be toggled any
    time with `G`uide / the **Guide** button (`D`). When you're not spanning, it
    previews the multi-monitor layout as a scaled mini-map so you can see how the
    screen *would* be carved up before you commit.
- **Tile to Displays** (`T`) — one click lays the tiles out to **match your
  monitor arrangement** (rows, columns or grids of screens), so each video fills
  exactly one display when you span. Existing folder assignments are kept.
- **Minimal, auto-hiding interface** — the top bar, tile controls and even the
  mouse cursor fade away when you stop interacting, leaving a clean viewing
  surface. They reappear the moment you move the mouse.
- **Alignment grid** — toggle a grid of squares to lay tiles out neatly and
  symmetrically. The cell size is adjustable.
- **Snap to grid** — when enabled, splits and divider drags snap to the grid for
  perfectly aligned layouts.
- **Resizable dividers** — drag the divider between any two tiles to rebalance
  them (snaps to the grid when snap is on).
- **Delete tiles** — made a wrong split? While editing, hit the **🗑** badge on a
  tile or press `Delete` / `Backspace` to remove it; its space is reclaimed by
  the neighbouring tile.
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
| Delete / merge a tile | The **🗑** badge on the tile (in edit mode), the toolbar **✕**, or `Delete` / `Backspace` on the hovered/focused tile |
| Assign a folder | The **📁** button on a tile, or the *Choose media folder…* button |
| Play / pause focused tile | `Space` |
| Loop the current video (per tile) | The **🔁** button on the tile |
| Toggle alignment grid | `G` or the **Grid** button |
| Toggle snap to grid | `S` or the **Snap** button |
| Adjust grid cell size | The **Cell** slider |
| Reset layout | The **Reset** button |
| Fullscreen (current display) | `F` or the **Fullscreen** button |
| Fullscreen across ALL displays | `A` or the **All Displays** button |
| Toggle the screen-split guide | `D` or the **Guide** button |
| Tile layout to match displays | `T` or the **Tile to Displays** button |
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
