"""TileView – tiling video player desktop application."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PyQt6.QtWidgets import QApplication
from PyQt6.QtGui import QPalette, QColor
from PyQt6.QtCore import Qt

from src.main_window import MainWindow


def _apply_dark_palette(app: QApplication) -> None:
    app.setStyle("Fusion")
    pal = QPalette()
    pal.setColor(QPalette.ColorRole.Window,          QColor(18, 18, 18))
    pal.setColor(QPalette.ColorRole.WindowText,      QColor(220, 220, 220))
    pal.setColor(QPalette.ColorRole.Base,            QColor(22, 22, 22))
    pal.setColor(QPalette.ColorRole.AlternateBase,   QColor(30, 30, 30))
    pal.setColor(QPalette.ColorRole.ToolTipBase,     QColor(30, 30, 30))
    pal.setColor(QPalette.ColorRole.ToolTipText,     QColor(220, 220, 220))
    pal.setColor(QPalette.ColorRole.Text,            QColor(220, 220, 220))
    pal.setColor(QPalette.ColorRole.Button,          QColor(35, 35, 35))
    pal.setColor(QPalette.ColorRole.ButtonText,      QColor(220, 220, 220))
    pal.setColor(QPalette.ColorRole.BrightText,      QColor(255, 80, 80))
    pal.setColor(QPalette.ColorRole.Link,            QColor(0, 140, 255))
    pal.setColor(QPalette.ColorRole.Highlight,       QColor(0, 120, 212))
    pal.setColor(QPalette.ColorRole.HighlightedText, QColor(255, 255, 255))
    app.setPalette(pal)


def main() -> None:
    # Request X11 on Linux for best mpv embedding compatibility
    if sys.platform.startswith("linux") and "WAYLAND_DISPLAY" in os.environ:
        os.environ.setdefault("QT_QPA_PLATFORM", "xcb")

    app = QApplication(sys.argv)
    app.setApplicationName("TileView")
    app.setOrganizationName("TileView")
    app.setApplicationDisplayName("TileView")
    _apply_dark_palette(app)

    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
