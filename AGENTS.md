# AGENTS.md

## Cursor Cloud specific instructions

Local Video Tiler is a single **Electron desktop app** (no backend/services, no
database). Source layout and user-facing controls are documented in `README.md`;
the npm scripts live in `package.json`. There is no automated test suite — `npm
run lint` only runs `node --check` syntax validation on the JS files.

### Running the app in the cloud VM (headless GUI)

The VM is a headless container with a virtual X server on `DISPLAY=:1` (the same
display the computer-use desktop shows). Electron will not start with its default
flags here; launch it like this:

```bash
DISPLAY=:1 npx electron . --no-sandbox --disable-gpu
```

- `--no-sandbox` is required (the container cannot use the Chromium sandbox).
- `--disable-gpu` forces software rendering; without it the whole window paints
  black because GPU init fails.

### Non-obvious rendering quirk (NOT an app bug)

Under software rendering the `#stage` (video tile) area only repaints fully after
a **window-size change**. On first load the central area can look black on the
desktop even though the DOM is fully correct. To force it to paint, press `F`
(toggle fullscreen) or otherwise resize the window. The top control bar repaints
on its own (CSS transitions), so seeing only the top bar with a black body is the
tell-tale sign of this quirk. This is purely a headless-display limitation.

### Driving / capturing the UI reliably (automation & screenshots)

Because of the repaint quirk and the native folder-picker dialog, the most
reliable way to test programmatically is the Chrome DevTools Protocol:

```bash
DISPLAY=:1 npx electron . --no-sandbox --disable-gpu --remote-debugging-port=9222
```

Then connect to `http://localhost:9222/json` (Node 22 has a built-in `WebSocket`,
so no extra deps are needed). Useful tricks:

- Layout + folder assignments persist in `localStorage` under the key
  `lvt.state.v1`. You can seed a layout (e.g. a `split` of two `leaf`s each with a
  `folder` path) and `location.reload()` to skip the native folder dialog. On
  load the app re-reads each folder and rebuilds the tiles.
- The folder picker (`Choose media folder…`) is a native GTK dialog; prefer the
  `localStorage` seeding approach above for automated runs instead of driving it.
- Playback only works for codecs Chromium supports — use **MP4 (H.264/AAC)**,
  WebM, or Ogg test files. `ffmpeg` is available in the VM to generate samples.
