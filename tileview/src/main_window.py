"""MainWindow – top-level application window.

Features
--------
• Auto-hiding toolbar at the top edge (appears when mouse within 6 px of top)
• Edit mode toggle     – [E] or toolbar button
• Grid overlay toggle  – [G] or toolbar button
• Snap toggle          – [S] or toolbar button
• Fullscreen           – [F]
• Span all displays    – [Ctrl+F] or toolbar button
• Keyboard shortcuts   shown in toolbar tooltips
"""

from __future__ import annotations

import sys
from typing import List, Optional

from PyQt6.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QPushButton, QLabel, QSizePolicy, QApplication,
    QSpinBox, QFrame,
)
from PyQt6.QtCore import Qt, QTimer, QRect, QPoint, QSize, pyqtSignal
from PyQt6.QtGui import QKeyEvent, QMouseEvent, QColor, QIcon, QCursor

from .tiling import TilingContainer
from .overlay import EditOverlay
from .config import (
    TOOLBAR_AUTOHIDE_DELAY_MS, TOOLBAR_SHOW_ZONE_PX,
    DEFAULT_GRID_DIVISIONS,
)


# ── Toolbar ───────────────────────────────────────────────────────────────────

class ToolBar(QWidget):
    """Floating auto-hiding toolbar pinned to the top of the main area."""

    edit_toggled    = pyqtSignal(bool)
    grid_toggled    = pyqtSignal(bool)
    snap_toggled    = pyqtSignal(bool)
    grid_size_changed = pyqtSignal(int)
    fullscreen_clicked = pyqtSignal()
    span_clicked    = pyqtSignal()

    def __init__(self, parent: QWidget) -> None:
        super().__init__(parent)
        self.setFixedHeight(44)
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setStyleSheet("""
            ToolBar {
                background: rgba(12, 12, 12, 220);
                border-bottom: 1px solid #2a2a2a;
            }
        """)

        self._edit_active = False
        self._grid_active = False
        self._snap_active = False

        self._build_ui()

    def _build_ui(self) -> None:
        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 4, 10, 4)
        layout.setSpacing(6)

        # App label
        app_lbl = QLabel("TileView", self)
        app_lbl.setStyleSheet("color:#888; font-size:13px; font-weight:bold; letter-spacing:1px;")
        layout.addWidget(app_lbl)

        sep = self._make_separator()
        layout.addWidget(sep)

        self._btn_edit = self._toggle_btn("✏ Edit Mode", "Toggle edit mode [E]")
        self._btn_edit.clicked.connect(self._on_edit_clicked)
        layout.addWidget(self._btn_edit)

        sep2 = self._make_separator()
        layout.addWidget(sep2)

        lbl_grid = QLabel("Grid:", self)
        lbl_grid.setStyleSheet("color:#666; font-size:12px;")
        layout.addWidget(lbl_grid)

        self._btn_grid = self._toggle_btn("⊞ Grid", "Toggle grid overlay [G]")
        self._btn_grid.clicked.connect(self._on_grid_clicked)
        layout.addWidget(self._btn_grid)

        self._btn_snap = self._toggle_btn("⊡ Snap", "Toggle snap to grid [S]")
        self._btn_snap.clicked.connect(self._on_snap_clicked)
        layout.addWidget(self._btn_snap)

        lbl_n = QLabel("Div:", self)
        lbl_n.setStyleSheet("color:#555; font-size:11px;")
        layout.addWidget(lbl_n)

        self._spin_grid = QSpinBox(self)
        self._spin_grid.setRange(2, 32)
        self._spin_grid.setValue(DEFAULT_GRID_DIVISIONS)
        self._spin_grid.setFixedWidth(52)
        self._spin_grid.setFixedHeight(28)
        self._spin_grid.setToolTip("Grid divisions (n × n)")
        self._spin_grid.setStyleSheet("""
            QSpinBox {
                background:#1e1e1e; color:#ccc; border:1px solid #333;
                border-radius:4px; padding:2px 4px; font-size:12px;
            }
            QSpinBox::up-button, QSpinBox::down-button { width:16px; }
        """)
        self._spin_grid.valueChanged.connect(self.grid_size_changed)
        layout.addWidget(self._spin_grid)

        sep3 = self._make_separator()
        layout.addWidget(sep3)

        self._btn_fs = self._action_btn("⛶ Fullscreen", "Fullscreen current display [F]")
        self._btn_fs.clicked.connect(self.fullscreen_clicked)
        layout.addWidget(self._btn_fs)

        self._btn_span = self._action_btn("⧉ All Displays", "Span across all displays [Ctrl+F]")
        self._btn_span.clicked.connect(self.span_clicked)
        layout.addWidget(self._btn_span)

        layout.addStretch()

        # Keyboard hint
        hint = QLabel("[E] edit  [G] grid  [S] snap  [F] full  [Ctrl+F] span", self)
        hint.setStyleSheet("color:#333; font-size:10px;")
        layout.addWidget(hint)

    @staticmethod
    def _make_separator() -> QFrame:
        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.VLine)
        sep.setFixedWidth(1)
        sep.setFixedHeight(28)
        sep.setStyleSheet("color: #2a2a2a;")
        return sep

    def _toggle_btn(self, text: str, tip: str) -> QPushButton:
        b = QPushButton(text, self)
        b.setToolTip(tip)
        b.setFixedHeight(30)
        b.setCheckable(False)
        b.setStyleSheet(self._btn_style(False))
        return b

    def _action_btn(self, text: str, tip: str) -> QPushButton:
        b = QPushButton(text, self)
        b.setToolTip(tip)
        b.setFixedHeight(30)
        b.setStyleSheet(self._btn_style(False))
        return b

    @staticmethod
    def _btn_style(active: bool) -> str:
        bg = "#0078d4" if active else "transparent"
        color = "#fff" if active else "#bbb"
        return f"""
            QPushButton {{
                color: {color}; background: {bg};
                border: 1px solid {'#0060b0' if active else '#333'};
                border-radius: 5px; padding: 2px 10px; font-size: 12px;
            }}
            QPushButton:hover {{
                background: {'#005fa3' if active else 'rgba(255,255,255,15)'};
            }}
        """

    def _on_edit_clicked(self) -> None:
        self._edit_active = not self._edit_active
        self._btn_edit.setStyleSheet(self._btn_style(self._edit_active))
        self._btn_edit.setText("✏ Edit Mode  ●" if self._edit_active else "✏ Edit Mode")
        self.edit_toggled.emit(self._edit_active)

    def _on_grid_clicked(self) -> None:
        self._grid_active = not self._grid_active
        self._btn_grid.setStyleSheet(self._btn_style(self._grid_active))
        self.grid_toggled.emit(self._grid_active)

    def _on_snap_clicked(self) -> None:
        self._snap_active = not self._snap_active
        self._btn_snap.setStyleSheet(self._btn_style(self._snap_active))
        self.snap_toggled.emit(self._snap_active)

    def sync_edit_state(self, active: bool) -> None:
        """Sync button state without emitting a signal (for keyboard shortcut feedback)."""
        self._edit_active = active
        self._btn_edit.setStyleSheet(self._btn_style(active))
        self._btn_edit.setText("✏ Edit Mode  ●" if active else "✏ Edit Mode")

    def sync_grid_state(self, active: bool) -> None:
        self._grid_active = active
        self._btn_grid.setStyleSheet(self._btn_style(active))

    def sync_snap_state(self, active: bool) -> None:
        self._snap_active = active
        self._btn_snap.setStyleSheet(self._btn_style(active))


# ── Main container (tiling + overlay stacked) ─────────────────────────────────

class MainArea(QWidget):
    """Widget that stacks TilingContainer and EditOverlay at the same geometry."""

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self._tiling = TilingContainer(self)
        self._overlay = EditOverlay(self._tiling, self)

    @property
    def tiling(self) -> TilingContainer:
        return self._tiling

    @property
    def overlay(self) -> EditOverlay:
        return self._overlay

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        super().resizeEvent(event)
        r = self.rect()
        self._tiling.setGeometry(r)
        self._overlay.setGeometry(r)
        self._overlay.raise_()


# ── Main window ────────────────────────────────────────────────────────────────

class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("TileView")
        self.resize(1280, 720)
        self.setMinimumSize(400, 300)
        self.setStyleSheet("QMainWindow { background: #121212; }")
        self.setMouseTracking(True)

        self._span_mode: bool = False
        self._saved_geometry: Optional[QRect] = None

        # Central area
        self._main_area = MainArea(self)
        self.setCentralWidget(self._main_area)

        # Floating toolbar (child of central widget so it overlays)
        self._toolbar = ToolBar(self._main_area)
        self._toolbar.raise_()

        self._autohide_timer = QTimer(self)
        self._autohide_timer.setSingleShot(True)
        self._autohide_timer.setInterval(TOOLBAR_AUTOHIDE_DELAY_MS)
        self._autohide_timer.timeout.connect(self._hide_toolbar)

        self._connect_signals()
        self._position_toolbar()

        # Start with toolbar visible, then auto-hide
        self._toolbar.show()
        self._autohide_timer.start()

    # ── Signals ───────────────────────────────────────────────────────────────

    def _connect_signals(self) -> None:
        tb = self._toolbar
        tb.edit_toggled.connect(self._on_edit_toggled)
        tb.grid_toggled.connect(self._on_grid_toggled)
        tb.snap_toggled.connect(self._on_snap_toggled)
        tb.grid_size_changed.connect(self._on_grid_size_changed)
        tb.fullscreen_clicked.connect(self._toggle_fullscreen)
        tb.span_clicked.connect(self._toggle_span_all)

        ov = self._main_area.overlay
        ov.split_requested.connect(self._on_split_requested)
        ov.edit_mode_exited.connect(lambda: self._set_edit_mode(False))

    # ── Edit mode ─────────────────────────────────────────────────────────────

    def _on_edit_toggled(self, active: bool) -> None:
        self._set_edit_mode(active)

    def _set_edit_mode(self, active: bool) -> None:
        self._main_area.overlay.set_edit_mode(active)
        self._toolbar.sync_edit_state(active)
        if active:
            self._show_toolbar_permanent()
        else:
            self._autohide_timer.start()

    # ── Grid / Snap ───────────────────────────────────────────────────────────

    def _on_grid_toggled(self, active: bool) -> None:
        ov = self._main_area.overlay
        ov.set_grid_enabled(active)
        self._toolbar.sync_grid_state(active)

    def _on_snap_toggled(self, active: bool) -> None:
        ov = self._main_area.overlay
        ov.set_snap_enabled(active)
        self._toolbar.sync_snap_state(active)

    def _on_grid_size_changed(self, n: int) -> None:
        self._main_area.overlay.set_grid_divisions(n)

    # ── Split ─────────────────────────────────────────────────────────────────

    def _on_split_requested(self, tile, direction: str, ratio: float) -> None:
        self._main_area.tiling.split_tile(tile, direction, ratio)

    # ── Fullscreen / multi-display ────────────────────────────────────────────

    def _toggle_fullscreen(self) -> None:
        if self.isFullScreen():
            self.showNormal()
        else:
            self._span_mode = False
            self.showFullScreen()

    def _toggle_span_all(self) -> None:
        if self._span_mode:
            self._span_mode = False
            self.setWindowFlags(self.windowFlags() & ~Qt.WindowType.FramelessWindowHint)
            if self._saved_geometry:
                self.setGeometry(self._saved_geometry)
            self.show()
            self.showNormal()
        else:
            self._saved_geometry = self.geometry()
            combined = self._all_screens_rect()
            self._span_mode = True
            self.showNormal()
            self.setWindowFlags(self.windowFlags() | Qt.WindowType.FramelessWindowHint)
            self.setGeometry(combined)
            self.show()

    @staticmethod
    def _all_screens_rect() -> QRect:
        screens = QApplication.screens()
        if not screens:
            return QRect(0, 0, 1920, 1080)
        combined = screens[0].geometry()
        for screen in screens[1:]:
            combined = combined.united(screen.geometry())
        return combined

    # ── Toolbar auto-hide ─────────────────────────────────────────────────────

    def _position_toolbar(self) -> None:
        area_w = self._main_area.width() or self.width()
        self._toolbar.setGeometry(0, 0, area_w, self._toolbar.height())
        self._toolbar.raise_()

    def _show_toolbar_permanent(self) -> None:
        self._autohide_timer.stop()
        self._toolbar.show()
        self._toolbar.raise_()

    def _show_toolbar_timed(self) -> None:
        self._toolbar.show()
        self._toolbar.raise_()
        self._autohide_timer.start()

    def _hide_toolbar(self) -> None:
        if not self._main_area.overlay.edit_mode:
            self._toolbar.hide()

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        super().resizeEvent(event)
        self._position_toolbar()

    # ── Global mouse tracking for toolbar show-zone ───────────────────────────

    def mouseMoveEvent(self, event: QMouseEvent) -> None:  # type: ignore[override]
        super().mouseMoveEvent(event)
        self._handle_mouse_for_toolbar(event.pos().y())

    def _handle_mouse_for_toolbar(self, y: int) -> None:
        if y <= TOOLBAR_SHOW_ZONE_PX:
            self._show_toolbar_timed()
        else:
            if self._toolbar.isVisible() and not self._main_area.overlay.edit_mode:
                self._autohide_timer.start()

    def eventFilter(self, obj, event) -> bool:  # type: ignore[override]
        from PyQt6.QtCore import QEvent
        if event.type() == QEvent.Type.MouseMove:
            try:
                local_y = self._main_area.mapFromGlobal(
                    event.globalPosition().toPoint()
                ).y()
                self._handle_mouse_for_toolbar(local_y)
            except Exception:
                pass
        return super().eventFilter(obj, event)

    # ── Keyboard shortcuts ────────────────────────────────────────────────────

    def keyPressEvent(self, event: QKeyEvent) -> None:  # type: ignore[override]
        key = event.key()
        mods = event.modifiers()

        if key == Qt.Key.Key_E:
            active = not self._main_area.overlay.edit_mode
            self._set_edit_mode(active)
            self._toolbar.sync_edit_state(active)
        elif key == Qt.Key.Key_G:
            active = not self._main_area.overlay.grid_enabled
            self._main_area.overlay.set_grid_enabled(active)
            self._toolbar.sync_grid_state(active)
        elif key == Qt.Key.Key_S:
            active = not self._main_area.overlay.snap_enabled
            self._main_area.overlay.set_snap_enabled(active)
            self._toolbar.sync_snap_state(active)
        elif key == Qt.Key.Key_F:
            if mods & Qt.KeyboardModifier.ControlModifier:
                self._toggle_span_all()
            else:
                self._toggle_fullscreen()
        elif key == Qt.Key.Key_Escape:
            if self._main_area.overlay.edit_mode:
                self._set_edit_mode(False)
            elif self.isFullScreen() or self._span_mode:
                if self._span_mode:
                    self._toggle_span_all()
                else:
                    self.showNormal()
        elif key == Qt.Key.Key_T:
            # Show toolbar briefly
            self._show_toolbar_timed()
        else:
            super().keyPressEvent(event)
