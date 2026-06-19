# TileView

A desktop video player with a fully customisable tiling layout — like a tiling window manager, but for video files.

---

## Features

| Feature | Details |
|---|---|
| **Tiling layout** | Split any pane vertically or horizontally, unlimited depth |
| **Edit mode** | Locked behind `[E]` — hover preview shows exactly where the split will land |
| **Smart split** | Click = vertical split; Shift+Click = horizontal split |
| **Mouse-position splits** | Split position follows your cursor (not always 50/50) |
| **Grid overlay** | `[G]` toggles an n×n grid for symmetric layouts |
| **Snap-to-grid** | `[S]` snaps split lines to the nearest grid division |
| **Folder per tile** | Right-click any tile → Assign Folder (or drag a folder onto it) |
| **Auto-playlist** | Plays all videos in the assigned folder, advances automatically |
| **Auto-hiding UI** | Toolbar hides after 2.5 s; tile controls appear on hover |
| **Multi-display span** | `[Ctrl+F]` spans the window across ALL connected displays |
| **Single-screen full** | `[F]` fullscreens the current display |
| **Video backends** | libmpv (preferred) or Qt6 Multimedia (FFmpeg) fallback |

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `E` | Toggle **edit mode** |
| `G` | Toggle **grid overlay** |
| `S` | Toggle **snap to grid** |
| `F` | Fullscreen (current display) |
| `Ctrl+F` | Span **all displays** |
| `Esc` | Exit edit mode / exit fullscreen |
| `T` | Temporarily show the toolbar |

### In edit mode

| Input | Action |
|---|---|
| Click | Split tile **vertically** (left \| right) at cursor position |
| Shift+Click | Split tile **horizontally** (top / bottom) at cursor position |
| `Esc` or `E` | Leave edit mode |

---

## Installation

```bash
# 1. Clone / enter the project
cd tileview

# 2. Install system libraries (Debian / Ubuntu)
sudo apt install libmpv-dev mpv libegl-dev

# 3. Install Python dependencies
pip install PyQt6 python-mpv

# 4. Run
python3 main.py
```

### macOS

```bash
brew install mpv
pip install PyQt6 python-mpv
python3 main.py
```

### Windows

1. Download `mpv-dev` from <https://mpv.io/installation/> and put `libmpv-2.dll` alongside `main.py`
2. `pip install PyQt6 python-mpv`
3. `python main.py`

> **Wayland users:** TileView forces `QT_QPA_PLATFORM=xcb` automatically so that mpv
> embedding via the X window ID works correctly.  If XWayland is not available,
> the app falls back to the Qt Multimedia backend (no embedding required).

---

## Assigning a folder to a tile

1. **Right-click** any tile → *Assign Folder…*
2. **Drag and drop** a folder onto a tile
3. Click the **📁** button in the tile's controls bar

TileView scans the folder for video files (`.mp4 .mkv .avi .mov .wmv .flv .webm .m4v .ts .m2ts …`) and builds an auto-advancing playlist.

---

## Tiling workflow

```
1. Press [E] to enter edit mode  (blue border appears)
2. Move cursor over a tile       (split preview line follows cursor)
3. Click                          → vertical split
   Shift+Click                   → horizontal split
4. Assign a folder to the new tile
5. Press [E] or [Esc] to leave edit mode
```

Enable **Grid** + **Snap** for pixel-perfect symmetric layouts.

---

## Architecture

```
tileview/
├── main.py               Entry point, dark palette
└── src/
    ├── config.py         Constants & runtime settings singleton
    ├── player.py         VideoPlayer widget (mpv / Qt Multimedia)
    ├── video_tile.py     VideoTile: player + controls + playlist panel
    ├── tiling.py         TilingContainer: QSplitter-based binary tile tree
    ├── overlay.py        EditOverlay: transparent layer for edit mode + grid
    └── main_window.py    MainWindow + auto-hiding ToolBar + keyboard shortcuts
```
