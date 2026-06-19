"""VideoTile – single tiling pane containing a VideoPlayer and auto-hiding controls."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional, List

from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QSlider, QSizePolicy, QFileDialog,
    QListWidget, QListWidgetItem, QFrame, QAbstractItemView,
)
from PyQt6.QtCore import Qt, QTimer, pyqtSignal, QSize
from PyQt6.QtGui import QIcon, QFont, QCursor

from .player import VideoPlayer
from .config import (
    VIDEO_EXTENSIONS, CONTROLS_HEIGHT, CONTROLS_AUTOHIDE_DELAY_MS,
    TILE_BORDER_PX, TILE_MIN_WIDTH, TILE_MIN_HEIGHT,
)


class ControlsBar(QWidget):
    """Overlay controls bar shown at the bottom of a tile."""

    play_pause_clicked  = pyqtSignal()
    seek_requested      = pyqtSignal(int)   # ms
    volume_changed      = pyqtSignal(int)   # 0-100
    folder_requested    = pyqtSignal()
    playlist_toggled    = pyqtSignal()
    prev_requested      = pyqtSignal()
    next_requested      = pyqtSignal()
    close_requested     = pyqtSignal()

    def __init__(self, parent: QWidget) -> None:
        super().__init__(parent)
        self.setFixedHeight(CONTROLS_HEIGHT + 4)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self._build_ui()
        self._duration_ms: int = 0

    def _build_ui(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # Seek bar
        self._seek = QSlider(Qt.Orientation.Horizontal, self)
        self._seek.setRange(0, 1000)
        self._seek.setFixedHeight(10)
        self._seek.setStyleSheet("""
            QSlider::groove:horizontal {
                background: rgba(255,255,255,40);
                height: 3px;
                border-radius: 2px;
            }
            QSlider::sub-page:horizontal {
                background: #0078d4;
                border-radius: 2px;
            }
            QSlider::handle:horizontal {
                background: #fff;
                width: 10px; height: 10px;
                margin: -4px 0;
                border-radius: 5px;
            }
        """)
        self._seek.sliderMoved.connect(self._on_seek_moved)
        root.addWidget(self._seek)

        # Button row
        btn_row = QWidget(self)
        btn_row.setStyleSheet("background: rgba(0,0,0,175); border-radius: 0px;")
        btn_layout = QHBoxLayout(btn_row)
        btn_layout.setContentsMargins(8, 2, 8, 4)
        btn_layout.setSpacing(4)

        def _btn(text: str, tip: str, fixed_width: int = 32) -> QPushButton:
            b = QPushButton(text, btn_row)
            b.setToolTip(tip)
            b.setFixedSize(QSize(fixed_width, 28))
            b.setStyleSheet("""
                QPushButton {
                    color: #ddd; background: transparent;
                    border: none; font-size: 14px; border-radius: 4px;
                }
                QPushButton:hover { background: rgba(255,255,255,25); }
                QPushButton:pressed { background: rgba(255,255,255,45); }
            """)
            return b

        self._btn_prev   = _btn("⏮", "Previous")
        self._btn_pp     = _btn("⏸", "Play / Pause", 36)
        self._btn_next   = _btn("⏭", "Next")
        self._lbl_time   = QLabel("0:00 / 0:00", btn_row)
        self._lbl_time.setStyleSheet("color: #aaa; font-size: 11px; min-width: 80px;")
        self._lbl_file   = QLabel("", btn_row)
        self._lbl_file.setStyleSheet("color: #ccc; font-size: 11px;")
        self._lbl_file.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        self._lbl_file.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self._vol_slider = QSlider(Qt.Orientation.Horizontal, btn_row)
        self._vol_slider.setRange(0, 100)
        self._vol_slider.setValue(80)
        self._vol_slider.setFixedWidth(60)
        self._vol_slider.setFixedHeight(20)
        self._vol_slider.setStyleSheet("""
            QSlider::groove:horizontal { background: rgba(255,255,255,40); height:3px; border-radius:2px; }
            QSlider::sub-page:horizontal { background:#0078d4; border-radius:2px; }
            QSlider::handle:horizontal { background:#fff; width:8px; height:8px; margin:-3px 0; border-radius:4px; }
        """)
        self._vol_slider.valueChanged.connect(self.volume_changed)

        self._btn_folder   = _btn("📁", "Assign folder", 32)
        self._btn_playlist = _btn("☰", "Toggle playlist", 32)
        self._btn_close    = _btn("✕", "Close tile", 28)
        self._btn_close.setStyleSheet("""
            QPushButton { color:#888; background:transparent; border:none; font-size:13px; border-radius:4px; }
            QPushButton:hover { color:#ff5555; background:rgba(255,0,0,30); }
        """)

        for w in (self._btn_prev, self._btn_pp, self._btn_next, self._lbl_time,
                  self._lbl_file, self._vol_slider,
                  self._btn_folder, self._btn_playlist, self._btn_close):
            btn_layout.addWidget(w)

        root.addWidget(btn_row)

        # Connect buttons
        self._btn_prev.clicked.connect(self.prev_requested)
        self._btn_pp.clicked.connect(self.play_pause_clicked)
        self._btn_next.clicked.connect(self.next_requested)
        self._btn_folder.clicked.connect(self.folder_requested)
        self._btn_playlist.clicked.connect(self.playlist_toggled)
        self._btn_close.clicked.connect(self.close_requested)

    def _on_seek_moved(self, value: int) -> None:
        if self._duration_ms > 0:
            self.seek_requested.emit(int(value / 1000 * self._duration_ms))

    def set_position(self, ms: int) -> None:
        if self._duration_ms > 0:
            self._seek.setValue(int(ms / self._duration_ms * 1000))
        self._lbl_time.setText(f"{_fmt_time(ms)} / {_fmt_time(self._duration_ms)}")

    def set_duration(self, ms: int) -> None:
        self._duration_ms = ms
        self._lbl_time.setText(f"0:00 / {_fmt_time(ms)}")

    def set_playing(self, playing: bool) -> None:
        self._btn_pp.setText("⏸" if playing else "▶")

    def set_filename(self, name: str) -> None:
        self._lbl_file.setText(name)

    def set_volume_display(self, vol: int) -> None:
        self._vol_slider.setValue(vol)


def _fmt_time(ms: int) -> str:
    s = ms // 1000
    return f"{s // 60}:{s % 60:02d}"


class PlaylistPanel(QWidget):
    """Side panel showing the playlist for this tile."""

    file_selected = pyqtSignal(str)   # full path

    def __init__(self, parent: QWidget) -> None:
        super().__init__(parent)
        self.setMinimumWidth(180)
        self.setMaximumWidth(260)
        self.setStyleSheet("""
            background: rgba(10,10,10,210);
            border-left: 1px solid #2a2a2a;
        """)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(4, 4, 4, 4)
        layout.setSpacing(4)

        hdr = QLabel("Playlist", self)
        hdr.setStyleSheet("color:#888; font-size:11px; font-weight:bold; padding:2px;")
        layout.addWidget(hdr)

        self._list = QListWidget(self)
        self._list.setStyleSheet("""
            QListWidget { background:transparent; border:none; color:#ccc; font-size:12px; }
            QListWidget::item { padding:4px 6px; border-radius:3px; }
            QListWidget::item:selected { background:#0078d4; color:#fff; }
            QListWidget::item:hover { background:rgba(255,255,255,15); }
        """)
        self._list.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self._list.itemDoubleClicked.connect(self._on_double_click)
        layout.addWidget(self._list)

        self._files: List[str] = []

    def set_files(self, files: List[str]) -> None:
        self._files = files
        self._list.clear()
        for f in files:
            self._list.addItem(os.path.basename(f))

    def set_current(self, path: str) -> None:
        try:
            idx = self._files.index(path)
            self._list.setCurrentRow(idx)
        except ValueError:
            pass

    def _on_double_click(self, item: QListWidgetItem) -> None:
        row = self._list.row(item)
        if 0 <= row < len(self._files):
            self.file_selected.emit(self._files[row])


class _PlayerContainer(QWidget):
    """Thin container that notifies its VideoTile parent when it resizes."""

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        super().resizeEvent(event)
        tile = self.parent()
        if tile is not None:
            tile._layout_player_area()


class VideoTile(QWidget):
    """A single tiling pane: VideoPlayer + overlay controls + optional playlist panel."""

    # Emitted when this tile requests to be closed/removed
    close_requested = pyqtSignal(object)   # passes self

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self.setMinimumSize(TILE_MIN_WIDTH, TILE_MIN_HEIGHT)
        self.setStyleSheet(f"background:#000; border: {TILE_BORDER_PX}px solid #2a2a2a;")
        self.setMouseTracking(True)

        self._folder: Optional[str] = None
        self._files: List[str] = []
        self._current_index: int = -1

        self._build_ui()
        self._connect_signals()

        self._hide_timer = QTimer(self)
        self._hide_timer.setSingleShot(True)
        self._hide_timer.setInterval(CONTROLS_AUTOHIDE_DELAY_MS)
        self._hide_timer.timeout.connect(self._hide_controls)

        self._controls.hide()
        self._playlist_panel.hide()

    # ── UI construction ───────────────────────────────────────────────────────

    def _build_ui(self) -> None:
        main_layout = QHBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # Left area: player + controls stacked.
        # We subclass a thin container that relays resize events back to this tile.
        self._player_container = _PlayerContainer(self)
        self._player_container.setStyleSheet("background:#000;")
        self._player_container.setSizePolicy(
            QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        main_layout.addWidget(self._player_container, stretch=1)

        self._player = VideoPlayer(self._player_container)

        # Empty-state placeholder label
        self._empty_label = QLabel("Drop a folder here\nor right-click → Assign Folder", self._player_container)
        self._empty_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._empty_label.setStyleSheet("""
            color: #444; font-size: 14px;
            border: 2px dashed #2d2d2d; border-radius: 6px;
        """)
        self._empty_label.setWordWrap(True)

        # Controls bar (overlaid at the bottom)
        self._controls = ControlsBar(self._player_container)

        # Playlist panel
        self._playlist_panel = PlaylistPanel(self)
        main_layout.addWidget(self._playlist_panel)
        self._playlist_panel.hide()

    def _connect_signals(self) -> None:
        p = self._player
        p.position_changed.connect(self._controls.set_position)
        p.duration_changed.connect(self._controls.set_duration)
        p.file_ended.connect(self._on_file_ended)
        p.file_loaded.connect(self._controls.set_filename)

        c = self._controls
        c.play_pause_clicked.connect(p.toggle_play_pause)
        c.play_pause_clicked.connect(self._sync_play_button)
        c.seek_requested.connect(p.seek)
        c.volume_changed.connect(p.set_volume)
        c.folder_requested.connect(self.open_folder_dialog)
        c.playlist_toggled.connect(self._toggle_playlist)
        c.prev_requested.connect(self.play_previous)
        c.next_requested.connect(self.play_next)
        c.close_requested.connect(lambda: self.close_requested.emit(self))

        self._playlist_panel.file_selected.connect(self._play_file)

    # ── Layout management ─────────────────────────────────────────────────────

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        super().resizeEvent(event)
        self._layout_player_area()

    def _layout_player_area(self) -> None:
        cw = self._player_container.width()
        ch = self._player_container.height()
        self._player.setGeometry(0, 0, cw, ch)
        self._empty_label.setGeometry(0, 0, cw, ch)
        ctrl_h = self._controls.height()
        self._controls.setGeometry(0, ch - ctrl_h, cw, ctrl_h)

    # ── Folder / playlist management ──────────────────────────────────────────

    def assign_folder(self, path: str) -> None:
        self._folder = path
        exts = VIDEO_EXTENSIONS
        files = sorted(
            str(f) for f in Path(path).iterdir()
            if f.is_file() and f.suffix.lower() in exts
        )
        self._files = files
        self._playlist_panel.set_files(files)
        if files:
            self._empty_label.hide()
            self._current_index = 0
            self._play_file(files[0])
        else:
            self._empty_label.setText(f"No videos found in:\n{path}")
            self._empty_label.show()

    def open_folder_dialog(self) -> None:
        start = self._folder or os.path.expanduser("~")
        path = QFileDialog.getExistingDirectory(self, "Select Video Folder", start)
        if path:
            self.assign_folder(path)

    def _play_file(self, path: str) -> None:
        if path in self._files:
            self._current_index = self._files.index(path)
        self._player.load_file(path)
        self._playlist_panel.set_current(path)
        self._controls.set_playing(True)

    def _on_file_ended(self) -> None:
        self.play_next()

    def play_next(self) -> None:
        if not self._files:
            return
        self._current_index = (self._current_index + 1) % len(self._files)
        self._play_file(self._files[self._current_index])

    def play_previous(self) -> None:
        if not self._files:
            return
        self._current_index = (self._current_index - 1) % len(self._files)
        self._play_file(self._files[self._current_index])

    def _sync_play_button(self) -> None:
        self._controls.set_playing(self._player.is_playing)

    def _toggle_playlist(self) -> None:
        self._playlist_panel.setVisible(not self._playlist_panel.isVisible())

    # ── Auto-hiding controls ──────────────────────────────────────────────────

    def _show_controls(self) -> None:
        self._controls.show()
        self._controls.raise_()
        self._hide_timer.start()

    def _hide_controls(self) -> None:
        self._controls.hide()

    def enterEvent(self, event) -> None:  # type: ignore[override]
        super().enterEvent(event)
        self._show_controls()

    def leaveEvent(self, event) -> None:  # type: ignore[override]
        super().leaveEvent(event)
        self._hide_timer.start()

    def mouseMoveEvent(self, event) -> None:  # type: ignore[override]
        super().mouseMoveEvent(event)
        self._show_controls()

    # ── Context menu ─────────────────────────────────────────────────────────

    def contextMenuEvent(self, event) -> None:  # type: ignore[override]
        from PyQt6.QtWidgets import QMenu
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu { background:#1e1e1e; color:#ddd; border:1px solid #333; }
            QMenu::item:selected { background:#0078d4; }
        """)
        menu.addAction("Assign Folder…", self.open_folder_dialog)
        if self._folder:
            menu.addAction("Clear / Reset", self._clear_folder)
        menu.addSeparator()
        menu.addAction("Close Tile", lambda: self.close_requested.emit(self))
        menu.exec(event.globalPos())

    def _clear_folder(self) -> None:
        self._folder = None
        self._files = []
        self._current_index = -1
        self._player.stop()
        self._playlist_panel.set_files([])
        self._empty_label.setText("Drop a folder here\nor right-click → Assign Folder")
        self._empty_label.show()

    # ── Drag-and-drop folder support ──────────────────────────────────────────

    def dragEnterEvent(self, event) -> None:  # type: ignore[override]
        if event.mimeData().hasUrls():
            urls = event.mimeData().urls()
            if urls and Path(urls[0].toLocalFile()).is_dir():
                event.acceptProposedAction()

    def dropEvent(self, event) -> None:  # type: ignore[override]
        urls = event.mimeData().urls()
        if urls:
            path = urls[0].toLocalFile()
            if Path(path).is_dir():
                self.assign_folder(path)

    def setAcceptDrops(self, accept: bool) -> None:
        super().setAcceptDrops(accept)

    # ── Public properties ─────────────────────────────────────────────────────

    @property
    def folder(self) -> Optional[str]:
        return self._folder

    @property
    def player(self) -> VideoPlayer:
        return self._player
