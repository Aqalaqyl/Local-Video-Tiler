import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { TileNode, SplitDirection, SplitPreview } from '../types/layout';
import {
  computeLayouts,
  findTileAtPoint,
  computeSplitRatio,
  splitTile,
} from '../utils/layoutTree';
import { MediaTile } from './MediaTile';
import { EditOverlay } from './EditOverlay';
import { GridOverlay } from './GridOverlay';

interface TileWorkspaceProps {
  layout: TileNode;
  editMode: boolean;
  showGrid: boolean;
  snapEnabled: boolean;
  gridDivisions: number;
  onLayoutChange: (layout: TileNode) => void;
  onAssignFolder: (tileId: string, folderPath: string) => void;
  onSelectVideo: (tileId: string, videoPath: string) => void;
  onRemoveTile: (tileId: string) => void;
  onActivity: () => void;
}

export function TileWorkspace({
  layout,
  editMode,
  showGrid,
  snapEnabled,
  gridDivisions,
  onLayoutChange,
  onAssignFolder,
  onSelectVideo,
  onRemoveTile,
  onActivity,
}: TileWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [shiftHeld, setShiftHeld] = useState(false);
  const [preview, setPreview] = useState<SplitPreview | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const layouts = useMemo(() => {
    if (containerSize.width === 0 || containerSize.height === 0) return [];
    return computeLayouts(layout, {
      x: 0,
      y: 0,
      width: containerSize.width,
      height: containerSize.height,
    });
  }, [layout, containerSize]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      onActivity();
      if (!editMode || !containerRef.current) {
        setPreview(null);
        return;
      }

      const bounds = containerRef.current.getBoundingClientRect();
      const x = e.clientX - bounds.left;
      const y = e.clientY - bounds.top;
      const tile = findTileAtPoint(layouts, x, y);
      if (!tile) {
        setPreview(null);
        return;
      }

      const direction: SplitDirection = shiftHeld ? 'horizontal' : 'vertical';
      const ratio = computeSplitRatio(
        tile.rect,
        direction,
        x,
        y,
        snapEnabled,
        gridDivisions
      );

      setPreview({
        tileId: tile.node.id,
        direction,
        ratio,
        x,
        y,
      });
    },
    [editMode, layouts, shiftHeld, snapEnabled, gridDivisions, onActivity]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!editMode || !preview) return;
      e.preventDefault();
      e.stopPropagation();
      const newLayout = splitTile(
        layout,
        preview.tileId,
        preview.direction,
        preview.ratio
      );
      onLayoutChange(newLayout);
      setPreview(null);
      onActivity();
    },
    [editMode, preview, layout, onLayoutChange, onActivity]
  );

  const handleMouseLeave = useCallback(() => {
    setPreview(null);
  }, []);

  const previewRect = useMemo(() => {
    if (!preview) return null;
    const tile = layouts.find((l) => l.node.id === preview.tileId);
    return tile?.rect ?? null;
  }, [preview, layouts]);

  return (
    <div
      ref={containerRef}
      className={`tile-workspace ${editMode ? 'editing' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onMouseDown={onActivity}
    >
      {showGrid && editMode && <GridOverlay divisions={gridDivisions} />}

      {layouts.map((item) => {
        if (item.node.type !== 'leaf') return null;
        return (
          <div
            key={item.node.id}
            className="tile-frame"
            style={{
              left: item.rect.x,
              top: item.rect.y,
              width: item.rect.width,
              height: item.rect.height,
            }}
          >
            <MediaTile
              tile={item.node}
              editMode={editMode}
              onAssignFolder={onAssignFolder}
              onSelectVideo={onSelectVideo}
              onRemove={onRemoveTile}
            />
          </div>
        );
      })}

      {editMode && preview && previewRect && (
        <EditOverlay
          rect={previewRect}
          direction={preview.direction}
          ratio={preview.ratio}
          shiftHeld={shiftHeld}
        />
      )}
    </div>
  );
}
