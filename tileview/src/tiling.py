"""TilingContainer – manages a hierarchy of QSplitters and VideoTiles.

Split model
-----------
Every leaf is a VideoTile.  Splitting a leaf replaces it in its parent
QSplitter with a *new* QSplitter that contains the original tile plus a
freshly-created VideoTile.  Closing a tile reverses the process.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

from PyQt6.QtWidgets import (
    QWidget, QSplitter, QVBoxLayout, QSizePolicy,
)
from PyQt6.QtCore import Qt, pyqtSignal

from .video_tile import VideoTile
from .config import SPLITTER_HANDLE_WIDTH, SPLITTER_HANDLE_COLOR, SPLITTER_HANDLE_HOVER_COLOR


_SPLITTER_QSS = f"""
QSplitter::handle {{
    background: {SPLITTER_HANDLE_COLOR};
}}
QSplitter::handle:hover {{
    background: {SPLITTER_HANDLE_HOVER_COLOR};
}}
QSplitter::handle:horizontal {{
    width: {SPLITTER_HANDLE_WIDTH}px;
}}
QSplitter::handle:vertical {{
    height: {SPLITTER_HANDLE_WIDTH}px;
}}
"""


def _make_splitter(orientation: Qt.Orientation, parent: Optional[QWidget] = None) -> QSplitter:
    s = QSplitter(orientation, parent)
    s.setStyleSheet(_SPLITTER_QSS)
    s.setHandleWidth(SPLITTER_HANDLE_WIDTH)
    s.setChildrenCollapsible(False)
    return s


class TilingContainer(QWidget):
    """Root widget that owns the entire tile tree."""

    tile_count_changed = pyqtSignal(int)   # how many tiles currently exist

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self.setStyleSheet("background: #121212;")
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)

        self._layout = QVBoxLayout(self)
        self._layout.setContentsMargins(0, 0, 0, 0)
        self._layout.setSpacing(0)

        # Start with a single empty tile
        self._root: QWidget = self._make_tile()
        self._layout.addWidget(self._root)

    # ── Factory helpers ───────────────────────────────────────────────────────

    def _make_tile(self) -> VideoTile:
        tile = VideoTile(self)
        tile.setAcceptDrops(True)
        tile.close_requested.connect(self._on_tile_close_requested)
        return tile

    # ── Split API ─────────────────────────────────────────────────────────────

    def split_tile(
        self,
        tile: VideoTile,
        direction: str,
        ratio: float = 0.5,
    ) -> VideoTile:
        """Split *tile* and return the newly created sibling tile.

        direction: 'vertical'   → tile | new  (QSplitter Horizontal)
                   'horizontal' → tile / new  (QSplitter Vertical)
        ratio: 0.0–1.0, where the divider sits (default 0.5 = center)
        """
        orientation = (
            Qt.Orientation.Horizontal
            if direction == "vertical"
            else Qt.Orientation.Vertical
        )
        splitter = _make_splitter(orientation)
        new_tile = self._make_tile()

        parent = tile.parent()

        if isinstance(parent, QSplitter):
            idx = parent.indexOf(tile)
            old_sizes = parent.sizes()
            old_size = old_sizes[idx]
            tile.setParent(splitter)
            splitter.addWidget(tile)
            splitter.addWidget(new_tile)
            _apply_ratio(splitter, old_size, ratio)
            parent.insertWidget(idx, splitter)
            # Restore sibling sizes after insertion
            self._restore_sibling_sizes(parent, old_sizes, idx)

        elif parent is self or isinstance(parent, QWidget):
            # tile is the current root (single tile or first split)
            if self._root is tile:
                self._layout.removeWidget(tile)
                tile.setParent(splitter)
                splitter.addWidget(tile)
                splitter.addWidget(new_tile)
                total = (self.height() if direction == "horizontal" else self.width())
                _apply_ratio(splitter, total, ratio)
                self._root = splitter
                self._layout.addWidget(splitter)

        self.tile_count_changed.emit(len(self.all_tiles()))
        return new_tile

    @staticmethod
    def _restore_sibling_sizes(
        splitter: QSplitter,
        original_sizes: List[int],
        replaced_idx: int,
    ) -> None:
        """After inserting a new child splitter, restore the other panes' sizes."""
        new_sizes = splitter.sizes()
        if len(new_sizes) == len(original_sizes) + 1:
            # A new widget was inserted at replaced_idx; shift the rest
            rebuilt: List[int] = []
            for i, s in enumerate(new_sizes):
                if i < replaced_idx:
                    rebuilt.append(original_sizes[i])
                elif i == replaced_idx:
                    rebuilt.append(original_sizes[replaced_idx])
                else:
                    rebuilt.append(original_sizes[i - 1])
            splitter.setSizes(rebuilt)

    # ── Close / remove ────────────────────────────────────────────────────────

    def _on_tile_close_requested(self, tile: VideoTile) -> None:
        if len(self.all_tiles()) <= 1:
            return  # Never close the last tile
        self.remove_tile(tile)

    def remove_tile(self, tile: VideoTile) -> None:
        parent = tile.parent()
        if not isinstance(parent, QSplitter):
            return  # Can't remove the root tile without siblings

        sibling_idx = 1 - parent.indexOf(tile)  # assumes 2-child splitter
        if sibling_idx < 0 or sibling_idx >= parent.count():
            return

        sibling = parent.widget(sibling_idx)
        grandparent = parent.parent()

        if isinstance(grandparent, QSplitter):
            gp_idx = grandparent.indexOf(parent)
            gp_sizes = grandparent.sizes()
            # Pull the sibling out (makes it temporarily parentless)
            sibling.setParent(None)
            # Synchronously remove parent splitter from grandparent
            parent.hide()
            parent.setParent(None)
            # Place sibling back at the vacated slot
            grandparent.insertWidget(gp_idx, sibling)
            sibling.show()
            # Restore grandparent sizes
            new_sizes = grandparent.sizes()
            if len(new_sizes) == len(gp_sizes):
                new_sizes[gp_idx] = gp_sizes[gp_idx]
                grandparent.setSizes(new_sizes)
            # parent still owns tile as a child → both deleted together
            parent.deleteLater()

        elif grandparent is self:
            # parent IS the root splitter
            sibling.setParent(None)
            parent.hide()
            parent.setParent(None)
            self._layout.addWidget(sibling)
            sibling.show()
            parent.deleteLater()
            self._root = sibling

        self.tile_count_changed.emit(len(self.all_tiles()))

    # ── Query helpers ─────────────────────────────────────────────────────────

    def all_tiles(self) -> List[VideoTile]:
        """Return all leaf VideoTile widgets."""
        result: List[VideoTile] = []
        self._collect_tiles(self._root, result)
        return result

    @staticmethod
    def _collect_tiles(widget: QWidget, out: List[VideoTile]) -> None:
        if isinstance(widget, VideoTile):
            out.append(widget)
        elif isinstance(widget, QSplitter):
            for i in range(widget.count()):
                TilingContainer._collect_tiles(widget.widget(i), out)

    def tile_at_global_pos(self, gpos) -> Optional[VideoTile]:
        """Return the VideoTile whose geometry contains the given global position."""
        for tile in self.all_tiles():
            local = tile.mapFromGlobal(gpos)
            if tile.rect().contains(local):
                return tile
        return None

    def tile_rect_in_container(self, tile: VideoTile) -> Optional[object]:
        """Return tile geometry as a QRect in TilingContainer coordinates."""
        from PyQt6.QtCore import QRect
        tl = tile.mapTo(self, tile.rect().topLeft())
        return QRect(tl, tile.size())


def _apply_ratio(splitter: QSplitter, total: int, ratio: float) -> None:
    first  = max(20, int(total * ratio))
    second = max(20, total - first)
    splitter.setSizes([first, second])
