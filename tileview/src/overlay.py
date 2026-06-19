"""EditOverlay – transparent full-area widget that handles edit-mode interaction.

In edit mode this widget:
  • Intercepts mouse events (becomes opaque to events)
  • Highlights the hovered tile
  • Draws a preview split line following the cursor
    – no modifier  → vertical split   (left | right)
    – Shift held   → horizontal split (top  / bottom)
  • Optionally draws a grid over the entire area
  • With snap+grid active, snaps the split position to the nearest grid line

Outside edit mode the overlay is transparent to both rendering and mouse
events so videos play unobstructed.
"""

from __future__ import annotations

from typing import Optional, Tuple

from PyQt6.QtWidgets import QWidget
from PyQt6.QtCore import Qt, QPoint, QRect, QRectF, pyqtSignal
from PyQt6.QtGui import (
    QPainter, QColor, QPen, QBrush, QPaintEvent,
    QMouseEvent, QKeyEvent, QCursor,
)

from .config import (
    EDIT_SPLIT_LINE_COLOR, EDIT_HALF_FILL_COLOR, EDIT_TILE_BORDER_COLOR,
    GRID_LINE_COLOR, GRID_LINE_WIDTH,
    DEFAULT_GRID_DIVISIONS, SNAP_THRESHOLD_FRACTION,
)


class EditOverlay(QWidget):
    """Transparent overlay that renders edit-mode visuals and handles split events."""

    split_requested = pyqtSignal(object, str, float)   # (VideoTile, direction, ratio)
    edit_mode_exited = pyqtSignal()

    def __init__(self, tiling, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self._tiling = tiling    # TilingContainer reference

        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self.setAttribute(Qt.WidgetAttribute.WA_NoSystemBackground, True)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setMouseTracking(True)

        self._edit_mode: bool = False
        self._grid_enabled: bool = False
        self._snap_enabled: bool = False
        self._grid_divisions: int = DEFAULT_GRID_DIVISIONS

        self._hover_pos: Optional[QPoint] = None
        self._shift_held: bool = False
        self._hovered_tile_rect: Optional[QRect] = None
        self._split_ratio: float = 0.5

    # ── Mode setters ──────────────────────────────────────────────────────────

    def set_edit_mode(self, active: bool) -> None:
        self._edit_mode = active
        if active:
            self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, False)
            self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
            self.setCursor(Qt.CursorShape.CrossCursor)
            self.setFocus()
        else:
            self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
            self.unsetCursor()
            self._hover_pos = None
            self._hovered_tile_rect = None
        self.update()

    def set_grid_enabled(self, enabled: bool) -> None:
        self._grid_enabled = enabled
        self.update()

    def set_snap_enabled(self, enabled: bool) -> None:
        self._snap_enabled = enabled
        self.update()

    def set_grid_divisions(self, n: int) -> None:
        self._grid_divisions = max(2, n)
        self.update()

    @property
    def edit_mode(self) -> bool:
        return self._edit_mode

    @property
    def grid_enabled(self) -> bool:
        return self._grid_enabled

    @property
    def snap_enabled(self) -> bool:
        return self._snap_enabled

    # ── Paint ─────────────────────────────────────────────────────────────────

    def paintEvent(self, event: QPaintEvent) -> None:  # type: ignore[override]
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, False)

        if self._grid_enabled:
            self._draw_grid(painter)

        if self._edit_mode and self._hovered_tile_rect:
            self._draw_split_preview(painter)

        if self._edit_mode:
            self._draw_edit_mode_hint(painter)

        painter.end()

    def _draw_grid(self, painter: QPainter) -> None:
        w, h = self.width(), self.height()
        n = self._grid_divisions
        pen = QPen(QColor(*GRID_LINE_COLOR), GRID_LINE_WIDTH)
        painter.setPen(pen)
        for i in range(1, n):
            x = int(w * i / n)
            painter.drawLine(x, 0, x, h)
        for i in range(1, n):
            y = int(h * i / n)
            painter.drawLine(0, y, w, y)

    def _draw_split_preview(self, painter: QPainter) -> None:
        if self._hover_pos is None:
            return

        r = self._hovered_tile_rect
        ratio = self._split_ratio
        direction = "horizontal" if self._shift_held else "vertical"

        # Dim entire tile lightly
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QBrush(QColor(0, 0, 0, 60)))
        painter.drawRect(r)

        # Draw the two resulting halves
        if direction == "vertical":
            split_x = r.left() + int(r.width() * ratio)
            first_rect  = QRect(r.left(), r.top(), split_x - r.left(), r.height())
            second_rect = QRect(split_x, r.top(), r.right() - split_x + 1, r.height())
        else:
            split_y = r.top() + int(r.height() * ratio)
            first_rect  = QRect(r.left(), r.top(), r.width(), split_y - r.top())
            second_rect = QRect(r.left(), split_y, r.width(), r.bottom() - split_y + 1)

        # Fill the second (new) half
        fill_color = QColor(*EDIT_HALF_FILL_COLOR)
        painter.setBrush(QBrush(fill_color))
        painter.drawRect(second_rect)

        # Border around both halves
        border_pen = QPen(QColor(*EDIT_TILE_BORDER_COLOR), 1)
        painter.setPen(border_pen)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.drawRect(first_rect)
        painter.drawRect(second_rect)

        # Draw the split line
        line_pen = QPen(QColor(*EDIT_SPLIT_LINE_COLOR), 2)
        painter.setPen(line_pen)
        if direction == "vertical":
            split_x = r.left() + int(r.width() * ratio)
            painter.drawLine(split_x, r.top(), split_x, r.bottom())
        else:
            split_y = r.top() + int(r.height() * ratio)
            painter.drawLine(r.left(), split_y, r.right(), split_y)

        # Arrow / label hint
        mid_x = (first_rect.left() + first_rect.right()) // 2
        mid_y = (first_rect.top() + first_rect.bottom()) // 2
        painter.setPen(QPen(QColor(255, 255, 255, 160), 1))
        font = painter.font()
        font.setPointSize(9)
        painter.setFont(font)
        painter.drawText(
            QRect(r.left(), r.top(), r.width(), 22),
            Qt.AlignmentFlag.AlignCenter,
            "SHIFT+click = horizontal  |  click = vertical  |  ESC = exit edit",
        )

    def _draw_edit_mode_hint(self, painter: QPainter) -> None:
        # Subtle border around the whole area to indicate edit mode
        pen = QPen(QColor(30, 150, 255, 120), 2)
        painter.setPen(pen)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.drawRect(self.rect().adjusted(1, 1, -1, -1))

    # ── Mouse events ──────────────────────────────────────────────────────────

    def mouseMoveEvent(self, event: QMouseEvent) -> None:  # type: ignore[override]
        if not self._edit_mode:
            return
        self._hover_pos = event.pos()
        self._shift_held = bool(event.modifiers() & Qt.KeyboardModifier.ShiftModifier)
        self._update_hover_state()
        self.update()

    def mousePressEvent(self, event: QMouseEvent) -> None:  # type: ignore[override]
        if not self._edit_mode:
            return
        if event.button() != Qt.MouseButton.LeftButton:
            return

        gpos = event.globalPosition().toPoint()
        tile = self._tiling.tile_at_global_pos(gpos)
        if tile is None:
            return

        self._shift_held = bool(event.modifiers() & Qt.KeyboardModifier.ShiftModifier)
        direction = "horizontal" if self._shift_held else "vertical"
        self.split_requested.emit(tile, direction, self._split_ratio)

    def keyPressEvent(self, event: QKeyEvent) -> None:  # type: ignore[override]
        if event.key() in (Qt.Key.Key_Escape, Qt.Key.Key_E):
            self.edit_mode_exited.emit()
        elif event.key() == Qt.Key.Key_Shift:
            self._shift_held = True
            self.update()
        else:
            super().keyPressEvent(event)

    def keyReleaseEvent(self, event: QKeyEvent) -> None:  # type: ignore[override]
        if event.key() == Qt.Key.Key_Shift:
            self._shift_held = False
            self.update()
        else:
            super().keyReleaseEvent(event)

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _update_hover_state(self) -> None:
        if self._hover_pos is None:
            self._hovered_tile_rect = None
            self._split_ratio = 0.5
            return

        gpos = self.mapToGlobal(self._hover_pos)
        tile = self._tiling.tile_at_global_pos(gpos)
        if tile is None:
            self._hovered_tile_rect = None
            self._split_ratio = 0.5
            return

        tile_rect = self._tiling.tile_rect_in_container(tile)
        if tile_rect is None:
            self._hovered_tile_rect = None
            return
        # Map from TilingContainer coords to our (overlay) coords
        tiling_widget = self._tiling
        tl = tiling_widget.mapTo(self, tile_rect.topLeft())
        self._hovered_tile_rect = QRect(tl, tile_rect.size())

        # Compute ratio based on mouse position within the tile
        local_in_tile = self._hover_pos - self._hovered_tile_rect.topLeft()
        if self._shift_held:
            raw_ratio = local_in_tile.y() / max(1, self._hovered_tile_rect.height())
        else:
            raw_ratio = local_in_tile.x() / max(1, self._hovered_tile_rect.width())

        raw_ratio = max(0.1, min(0.9, raw_ratio))

        if self._snap_enabled and self._grid_enabled:
            raw_ratio = self._snap_to_grid(raw_ratio)

        self._split_ratio = raw_ratio

    def _snap_to_grid(self, ratio: float) -> float:
        n = self._grid_divisions
        threshold = SNAP_THRESHOLD_FRACTION
        for i in range(1, n):
            grid_ratio = i / n
            if abs(ratio - grid_ratio) <= threshold:
                return grid_ratio
        return ratio
