"""Application-wide constants and default settings."""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Tuple

# Supported video file extensions
VIDEO_EXTENSIONS: frozenset[str] = frozenset({
    ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv",
    ".webm", ".m4v", ".ts", ".m2ts", ".mts", ".m2v",
    ".ogv", ".3gp", ".divx", ".mpg", ".mpeg",
})

# ── Timing (milliseconds) ────────────────────────────────────────────────────
TOOLBAR_AUTOHIDE_DELAY_MS: int = 2500   # hide toolbar after this idle time
CONTROLS_AUTOHIDE_DELAY_MS: int = 2000  # hide tile controls after this idle time
TOOLBAR_SHOW_ZONE_PX: int = 6           # px from top edge that triggers toolbar reveal

# ── Edit-mode overlay ────────────────────────────────────────────────────────
EDIT_OVERLAY_TILE_DIM: Tuple[int, int] = (140, 80)  # rgba
EDIT_SPLIT_LINE_COLOR: Tuple[int, int, int, int] = (30, 150, 255, 220)
EDIT_HALF_FILL_COLOR: Tuple[int, int, int, int] = (30, 150, 255, 35)
EDIT_TILE_BORDER_COLOR: Tuple[int, int, int, int] = (30, 150, 255, 90)

# ── Grid ─────────────────────────────────────────────────────────────────────
DEFAULT_GRID_DIVISIONS: int = 8         # n×n grid squares by default
GRID_LINE_COLOR: Tuple[int, int, int, int] = (255, 255, 255, 28)
GRID_LINE_WIDTH: int = 1

# ── Snap ─────────────────────────────────────────────────────────────────────
SNAP_THRESHOLD_FRACTION: float = 0.04  # snap if within 4% of a grid line

# ── Tile ─────────────────────────────────────────────────────────────────────
TILE_BORDER_PX: int = 1
TILE_BORDER_COLOR: str = "#2a2a2a"
TILE_MIN_WIDTH: int = 120
TILE_MIN_HEIGHT: int = 68

# ── Controls bar ─────────────────────────────────────────────────────────────
CONTROLS_HEIGHT: int = 44
CONTROLS_BG: str = "rgba(0,0,0,180)"

# ── Splitter handle ──────────────────────────────────────────────────────────
SPLITTER_HANDLE_WIDTH: int = 4
SPLITTER_HANDLE_COLOR: str = "#1e1e1e"
SPLITTER_HANDLE_HOVER_COLOR: str = "#0078d4"


@dataclass
class AppSettings:
    """Mutable runtime settings (shared via singleton)."""
    edit_mode: bool = False
    grid_enabled: bool = False
    snap_enabled: bool = False
    grid_divisions: int = DEFAULT_GRID_DIVISIONS
    span_all_displays: bool = False
    volume: int = 80


# Module-level singleton; import and mutate this directly
settings = AppSettings()
