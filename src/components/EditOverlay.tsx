import type { CSSProperties } from 'react';
import type { SplitDirection, Rect } from '../types/layout';

interface EditOverlayProps {
  rect: Rect;
  direction: SplitDirection;
  ratio: number;
  shiftHeld: boolean;
}

export function EditOverlay({ rect, direction, ratio, shiftHeld }: EditOverlayProps) {
  const isVertical = direction === 'vertical';
  const lineStyle: CSSProperties = isVertical
    ? {
        left: rect.x + rect.width * ratio,
        top: rect.y,
        width: 2,
        height: rect.height,
      }
    : {
        left: rect.x,
        top: rect.y + rect.height * ratio,
        width: rect.width,
        height: 2,
      };

  const firstStyle: CSSProperties = isVertical
    ? {
        left: rect.x,
        top: rect.y,
        width: rect.width * ratio - 1,
        height: rect.height,
      }
    : {
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height * ratio - 1,
      };

  const secondStyle: CSSProperties = isVertical
    ? {
        left: rect.x + rect.width * ratio + 1,
        top: rect.y,
        width: rect.width * (1 - ratio) - 1,
        height: rect.height,
      }
    : {
        left: rect.x,
        top: rect.y + rect.height * ratio + 1,
        width: rect.width,
        height: rect.height * (1 - ratio) - 1,
      };

  return (
    <div className="edit-overlay">
      <div className="split-preview-first" style={firstStyle} />
      <div className="split-preview-second" style={secondStyle} />
      <div className={`split-preview-line ${isVertical ? 'vertical' : 'horizontal'}`} style={lineStyle} />
      <div
        className="split-hint"
        style={{
          left: rect.x + rect.width / 2,
          top: rect.y + 16,
        }}
      >
        {shiftHeld ? '↔ Horizontal split' : '↕ Vertical split'}
        <span className="split-hint-sub">Shift+click for horizontal</span>
      </div>
    </div>
  );
}
