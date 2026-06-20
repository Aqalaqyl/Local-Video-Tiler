import type { LayoutNode } from '../types/layout';
import type { DisplayInfo } from '../types/layout';
import { computeTileRects } from '../utils/layoutTree';

interface SplitIndicatorProps {
  layout: LayoutNode;
  visible: boolean;
  displays?: DisplayInfo[];
  displayMode?: 'single' | 'all';
  viewport?: {
    offsetX: number;
    offsetY: number;
    offsetW: number;
    offsetH: number;
    combinedW: number;
    combinedH: number;
  };
}

export function SplitIndicator({
  layout,
  visible,
  displays = [],
  displayMode = 'single',
  viewport,
}: SplitIndicatorProps) {
  if (!visible) return null;

  const tileRects = computeTileRects(layout);

  const toViewportStyle = (rect: { x: number; y: number; width: number; height: number }) => {
    if (!viewport) {
      return {
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.width * 100}%`,
        height: `${rect.height * 100}%`,
      };
    }

    const absX = rect.x * viewport.combinedW;
    const absY = rect.y * viewport.combinedH;
    const absW = rect.width * viewport.combinedW;
    const absH = rect.height * viewport.combinedH;

    const relX = ((absX - viewport.offsetX) / viewport.offsetW) * 100;
    const relY = ((absY - viewport.offsetY) / viewport.offsetH) * 100;
    const relW = (absW / viewport.offsetW) * 100;
    const relH = (absH / viewport.offsetH) * 100;

    return {
      left: `${relX}%`,
      top: `${relY}%`,
      width: `${relW}%`,
      height: `${relH}%`,
    };
  };

  const displayBoundaries =
    displayMode === 'all' && viewport
      ? displays
          .map((display, index) => {
            const localLeft =
              ((display.bounds.x - viewport.offsetX) / viewport.offsetW) * 100;
            const localTop =
              ((display.bounds.y - viewport.offsetY) / viewport.offsetH) * 100;
            const localWidth = (display.bounds.width / viewport.offsetW) * 100;
            const localHeight = (display.bounds.height / viewport.offsetH) * 100;

            const visible =
              display.bounds.x < viewport.offsetX + viewport.offsetW &&
              display.bounds.x + display.bounds.width > viewport.offsetX &&
              display.bounds.y < viewport.offsetY + viewport.offsetH &&
              display.bounds.y + display.bounds.height > viewport.offsetY;

            if (!visible) return null;

            return (
              <div
                key={display.id}
                className="display-boundary"
                style={{
                  left: `${Math.max(0, localLeft)}%`,
                  top: `${Math.max(0, localTop)}%`,
                  width: `${localWidth}%`,
                  height: `${localHeight}%`,
                }}
              >
                <span className="display-label">
                  {display.label || `Display ${index + 1}`}
                  {display.isPrimary ? ' (Primary)' : ''}
                </span>
              </div>
            );
          })
          .filter(Boolean)
      : [];

  return (
    <div className="split-indicator" aria-hidden>
      {tileRects.map((rect, index) => (
        <div
          key={rect.tileId}
          className="tile-indicator"
          style={toViewportStyle(rect)}
        >
          <span className="tile-label">Tile {index + 1}</span>
        </div>
      ))}
      {displayBoundaries}
    </div>
  );
}
