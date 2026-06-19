"""Video player widget.

Tries backends in order:
  1. python-mpv  (libmpv) – best codec support
  2. PyQt6 QtMultimedia – built-in fallback

Exposes a uniform interface used by VideoTile.
"""

from __future__ import annotations

import os
import sys
from typing import Optional

from PyQt6.QtWidgets import QWidget, QLabel, QVBoxLayout
from PyQt6.QtCore import Qt, pyqtSignal, QUrl, QTimer
from PyQt6.QtGui import QColor

from .config import VIDEO_EXTENSIONS

# ── Backend detection ─────────────────────────────────────────────────────────
_MPV_AVAILABLE = False
_QTMM_AVAILABLE = False

try:
    import mpv as _mpv_mod
    _MPV_AVAILABLE = True
except Exception:
    pass

try:
    from PyQt6.QtMultimedia import QMediaPlayer, QAudioOutput  # type: ignore
    from PyQt6.QtMultimediaWidgets import QVideoWidget          # type: ignore
    _QTMM_AVAILABLE = True
except Exception:
    pass


class VideoPlayer(QWidget):
    """Embeds a video player (mpv or Qt) inside this widget."""

    position_changed = pyqtSignal(int)   # current position in ms
    duration_changed = pyqtSignal(int)   # total duration in ms
    file_ended       = pyqtSignal()
    file_loaded      = pyqtSignal(str)   # basename of loaded file

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self.setMinimumSize(120, 68)
        self.setAttribute(Qt.WidgetAttribute.WA_NativeWindow, True)
        self.setAttribute(Qt.WidgetAttribute.WA_DontCreateNativeAncestors, True)
        self.setStyleSheet("background: #000;")

        self._current_file: Optional[str] = None
        self._playing: bool = False
        self._volume: int = 80
        self._backend: str = "none"

        # Position polling timer for mpv (mpv callbacks run on a foreign thread)
        self._pos_timer = QTimer(self)
        self._pos_timer.setInterval(250)
        self._pos_timer.timeout.connect(self._poll_mpv_position)

        if _MPV_AVAILABLE:
            self._try_init_mpv()
        elif _QTMM_AVAILABLE:
            self._init_qtmm()
        else:
            self._init_placeholder("No video backend.\nInstall python-mpv or GStreamer.")

    # ── MPV backend ───────────────────────────────────────────────────────────

    def _try_init_mpv(self) -> None:
        try:
            # Force a native window handle before passing it to mpv
            self.winId()
            wid = int(self.winId())
            self._mpv = _mpv_mod.MPV(
                wid=str(wid),
                keep_open="yes",
                idle="yes",
                osc="no",
                input_default_bindings="no",
                input_vo_keyboard="no",
                log_handler=self._mpv_log,
                loglevel="error",
            )
            self._mpv.volume = self._volume
            self._mpv.observe_property("duration", self._mpv_on_duration)
            self._mpv.register_event_callback(self._mpv_on_event)
            self._backend = "mpv"
            self._pos_timer.start()
        except Exception as exc:
            print(f"[TileView] mpv init failed ({exc}), falling back to Qt multimedia")
            self._mpv = None
            if _QTMM_AVAILABLE:
                self._init_qtmm()
            else:
                self._init_placeholder("mpv init failed and no Qt multimedia available.")

    def _mpv_log(self, loglevel: str, component: str, message: str) -> None:
        pass  # suppress to stdout

    def _mpv_on_event(self, event) -> None:
        try:
            import mpv as _m
            if event.event_id == _m.MpvEventID.END_FILE:
                QTimer.singleShot(0, self.file_ended)
        except Exception:
            pass

    def _mpv_on_duration(self, name: str, value) -> None:
        if value is not None:
            ms = int(value * 1000)
            QTimer.singleShot(0, lambda: self.duration_changed.emit(ms))

    def _poll_mpv_position(self) -> None:
        if self._backend != "mpv" or not hasattr(self, "_mpv") or self._mpv is None:
            return
        try:
            pos = self._mpv.time_pos
            if pos is not None:
                self.position_changed.emit(int(pos * 1000))
        except Exception:
            pass

    # ── Qt Multimedia backend ─────────────────────────────────────────────────

    def _init_qtmm(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self._video_widget = QVideoWidget(self)
        self._video_widget.setStyleSheet("background: #000;")
        layout.addWidget(self._video_widget)

        self._qplayer = QMediaPlayer(self)
        self._qaudio  = QAudioOutput(self)
        self._qplayer.setAudioOutput(self._qaudio)
        self._qplayer.setVideoOutput(self._video_widget)
        self._qaudio.setVolume(self._volume / 100.0)

        # qint64 → int adapters (PyQt6 strict type checking)
        self._qplayer.positionChanged.connect(lambda ms: self.position_changed.emit(int(ms)))
        self._qplayer.durationChanged.connect(lambda ms: self.duration_changed.emit(int(ms)))
        self._qplayer.mediaStatusChanged.connect(self._qtmm_on_status)
        self._backend = "qtmm"

    def _qtmm_on_status(self, status) -> None:
        from PyQt6.QtMultimedia import QMediaPlayer as _QMP  # type: ignore
        if status == _QMP.MediaStatus.EndOfMedia:
            self.file_ended.emit()

    # ── Placeholder backend ───────────────────────────────────────────────────

    def _init_placeholder(self, msg: str) -> None:
        layout = QVBoxLayout(self)
        lbl = QLabel(msg, self)
        lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lbl.setStyleSheet("color: #666; font-size: 13px;")
        lbl.setWordWrap(True)
        layout.addWidget(lbl)
        self._backend = "none"

    # ── Uniform playback API ──────────────────────────────────────────────────

    def load_file(self, path: str) -> None:
        self._current_file = path
        if self._backend == "mpv":
            self._mpv.play(path)
            self._playing = True
        elif self._backend == "qtmm":
            self._qplayer.setSource(QUrl.fromLocalFile(path))
            self._qplayer.play()
            self._playing = True
        self.file_loaded.emit(os.path.basename(path))

    def play(self) -> None:
        if self._backend == "mpv":
            self._mpv.pause = False
            self._playing = True
        elif self._backend == "qtmm":
            self._qplayer.play()
            self._playing = True

    def pause(self) -> None:
        if self._backend == "mpv":
            self._mpv.pause = True
            self._playing = False
        elif self._backend == "qtmm":
            self._qplayer.pause()
            self._playing = False

    def toggle_play_pause(self) -> None:
        if self._playing:
            self.pause()
        else:
            self.play()

    def stop(self) -> None:
        if self._backend == "mpv":
            self._mpv.stop()
        elif self._backend == "qtmm":
            self._qplayer.stop()
        self._playing = False

    def seek(self, ms: int) -> None:
        if self._backend == "mpv":
            try:
                self._mpv.seek(ms / 1000.0, "absolute")
            except Exception:
                pass
        elif self._backend == "qtmm":
            self._qplayer.setPosition(ms)

    def set_volume(self, volume: int) -> None:
        self._volume = max(0, min(100, volume))
        if self._backend == "mpv":
            self._mpv.volume = self._volume
        elif self._backend == "qtmm":
            self._qaudio.setVolume(self._volume / 100.0)

    # ── Properties ────────────────────────────────────────────────────────────

    @property
    def is_playing(self) -> bool:
        return self._playing

    @property
    def current_file(self) -> Optional[str]:
        return self._current_file

    @property
    def backend(self) -> str:
        return self._backend

    # ── Qt lifecycle ──────────────────────────────────────────────────────────

    def closeEvent(self, event) -> None:  # type: ignore[override]
        self._pos_timer.stop()
        if self._backend == "mpv" and hasattr(self, "_mpv") and self._mpv:
            try:
                self._mpv.terminate()
            except Exception:
                pass
        super().closeEvent(event)
