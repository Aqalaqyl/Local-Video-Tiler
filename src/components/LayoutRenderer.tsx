import type { LayoutNode } from '../types/layout';
import { isLeaf } from '../utils/layoutTree';
import { VideoTile } from './VideoTile';

interface LayoutRendererProps {
  node: LayoutNode;
  isEditMode: boolean;
  selectedTileId: string | null;
  onSelectTile: (tileId: string) => void;
  onAssignFolder: (tileId: string) => void;
  onVideoIndexChange: (tileId: string, index: number) => void;
}

export function LayoutRenderer({
  node,
  isEditMode,
  selectedTileId,
  onSelectTile,
  onAssignFolder,
  onVideoIndexChange,
}: LayoutRendererProps) {
  if (isLeaf(node)) {
    return (
      <VideoTile
        tileId={node.tile.id}
        folderPath={node.tile.folderPath}
        videoIndex={node.tile.videoIndex}
        isEditMode={isEditMode}
        isSelected={selectedTileId === node.tile.id}
        onSelect={onSelectTile}
        onAssignFolder={onAssignFolder}
        onVideoIndexChange={onVideoIndexChange}
      />
    );
  }

  const isHorizontal = node.direction === 'horizontal';

  return (
    <div
      className={`split-container ${isHorizontal ? 'horizontal' : 'vertical'}`}
      style={{
        gridTemplateColumns: isHorizontal ? `${node.ratio}fr ${1 - node.ratio}fr` : undefined,
        gridTemplateRows: !isHorizontal ? `${node.ratio}fr ${1 - node.ratio}fr` : undefined,
      }}
    >
      <div className="split-pane">
        <LayoutRenderer
          node={node.first}
          isEditMode={isEditMode}
          selectedTileId={selectedTileId}
          onSelectTile={onSelectTile}
          onAssignFolder={onAssignFolder}
          onVideoIndexChange={onVideoIndexChange}
        />
      </div>
      <div className="split-pane">
        <LayoutRenderer
          node={node.second}
          isEditMode={isEditMode}
          selectedTileId={selectedTileId}
          onSelectTile={onSelectTile}
          onAssignFolder={onAssignFolder}
          onVideoIndexChange={onVideoIndexChange}
        />
      </div>
    </div>
  );
}
