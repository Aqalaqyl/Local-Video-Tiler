import { useCallback, useEffect, useRef } from 'react';
import type { LayoutNode } from '../types/layout';
import { getSplitBoundaries, snapToGrid, clampRatio } from '../utils/layoutTree';

interface SplitHandlesProps {
  layout: LayoutNode;
  showGrid: boolean;
  gridColumns: number;
  gridRows: number;
  onRatioChange: (splitId: string, ratio: number) => void;
}

export function SplitHandles({
  layout,
  showGrid,
  gridColumns,
  gridRows,
  onRatioChange,
}: SplitHandlesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{
    splitId: string;
    direction: 'horizontal' | 'vertical';
    startPos: number;
    startRatio: number;
    containerSize: number;
  } | null>(null);

  const boundaries = getSplitBoundaries(layout);

  const handlePointerDown = useCallback(
    (
      e: React.PointerEvent,
      splitId: string,
      direction: 'horizontal' | 'vertical',
      currentRatio: number
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const container = containerRef.current?.parentElement;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      draggingRef.current = {
        splitId,
        direction,
        startPos: direction === 'horizontal' ? e.clientX : e.clientY,
        startRatio: currentRatio,
        containerSize: direction === 'horizontal' ? rect.width : rect.height,
      };

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    []
  );

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const drag = draggingRef.current;
      if (!drag) return;

      const delta =
        (drag.direction === 'horizontal' ? e.clientX : e.clientY) - drag.startPos;
      let newRatio = drag.startRatio + delta / drag.containerSize;

      if (showGrid) {
        const divisions = drag.direction === 'horizontal' ? gridColumns : gridRows;
        newRatio = snapToGrid(newRatio, divisions);
      }

      onRatioChange(drag.splitId, clampRatio(newRatio));
    };

    const onPointerUp = () => {
      draggingRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [showGrid, gridColumns, gridRows, onRatioChange]);

  const getRatioForSplit = (splitId: string): number => {
    function findRatio(node: LayoutNode): number | null {
      if (node.type === 'leaf') return null;
      if (node.id === splitId) return node.ratio;
      return findRatio(node.first) ?? findRatio(node.second);
    }
    return findRatio(layout) ?? 0.5;
  };

  return (
    <div className="split-handles" ref={containerRef}>
      {boundaries.map((boundary) => {
        const ratio = getRatioForSplit(boundary.id);
        const isH = boundary.direction === 'horizontal';

        return (
          <div
            key={boundary.id}
            className={`split-handle ${isH ? 'horizontal' : 'vertical'}`}
            style={
              isH
                ? {
                    left: `${boundary.position * 100}%`,
                    top: `${boundary.start * 100}%`,
                    height: `${(boundary.end - boundary.start) * 100}%`,
                  }
                : {
                    top: `${boundary.position * 100}%`,
                    left: `${boundary.start * 100}%`,
                    width: `${(boundary.end - boundary.start) * 100}%`,
                  }
            }
            onPointerDown={(e) => handlePointerDown(e, boundary.id, boundary.direction, ratio)}
          />
        );
      })}
    </div>
  );
}
