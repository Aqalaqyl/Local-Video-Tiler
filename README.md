# Local-Video-Tiler

Desktop app for local video playback with a customizable tiling layout.

## Features

- Edit mode locks layout changes behind an explicit toggle.
- Hover split preview in edit mode:
  - Left click to split the hovered tile vertically.
  - Shift + left click to split the hovered tile horizontally.
- Per-tile folder assignment for local media browsing and playback.
- Draggable split dividers with optional snapping.
- Optional visual square grid overlay for cleaner, symmetric tiling.
- Multi-display awareness with one-click "span all displays".
- Minimal UI that auto-hides when idle.

## Run locally

```bash
npm install
npm start
```

## Notes

- Supported media file extensions include: `.mp4`, `.m4v`, `.mkv`, `.webm`, `.mov`, `.avi`, `.flv`, `.wmv`.
- The app stores layout and UI preferences in local browser storage for the app window.
