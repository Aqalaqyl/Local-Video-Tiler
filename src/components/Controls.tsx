import type { DisplayInfo } from '../types/layout';

interface ControlsProps {
  visible: boolean;
  mode: 'edit' | 'view';
  isViewWindow: boolean;
  showGrid: boolean;
  showSplitIndicator: boolean;
  gridColumns: number;
  gridRows: number;
  displayMode: 'single' | 'all';
  displays: DisplayInfo[];
  selectedDisplayId: number | null;
  selectedTileId: string | null;
  onToggleGrid: () => void;
  onToggleSplitIndicator: () => void;
  onGridColumnsChange: (n: number) => void;
  onGridRowsChange: (n: number) => void;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onRemoveTile: () => void;
  onEnterView: () => void;
  onExitView: () => void;
  onDisplayModeChange: (mode: 'single' | 'all') => void;
  onDisplaySelect: (id: number) => void;
}

export function Controls({
  visible,
  mode,
  isViewWindow,
  showGrid,
  showSplitIndicator,
  gridColumns,
  gridRows,
  displayMode,
  displays,
  selectedDisplayId,
  selectedTileId,
  onToggleGrid,
  onToggleSplitIndicator,
  onGridColumnsChange,
  onGridRowsChange,
  onSplitHorizontal,
  onSplitVertical,
  onRemoveTile,
  onEnterView,
  onExitView,
  onDisplayModeChange,
  onDisplaySelect,
}: ControlsProps) {
  if (isViewWindow) {
    return (
      <div className={`controls view-controls ${visible ? 'visible' : 'hidden'}`}>
        <div className="controls-inner">
          <span className="controls-title">Viewing</span>
          <button type="button" className="ctrl-btn primary" onClick={onExitView}>
            Exit Fullscreen (Esc)
          </button>
          <button
            type="button"
            className={`ctrl-btn ${showSplitIndicator ? 'active' : ''}`}
            onClick={onToggleSplitIndicator}
          >
            Split Guide
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`controls ${visible ? 'visible' : 'hidden'}`}>
      <div className="controls-inner">
        <span className="controls-title">Local Video Tiler</span>

        <div className="control-group">
          <span className="group-label">Layout</span>
          <button
            type="button"
            className="ctrl-btn"
            onClick={onSplitHorizontal}
            disabled={!selectedTileId}
            title="Split selected tile horizontally"
          >
            Split ↔
          </button>
          <button
            type="button"
            className="ctrl-btn"
            onClick={onSplitVertical}
            disabled={!selectedTileId}
            title="Split selected tile vertically"
          >
            Split ↕
          </button>
          <button
            type="button"
            className="ctrl-btn danger"
            onClick={onRemoveTile}
            disabled={!selectedTileId}
            title="Remove selected tile"
          >
            Remove
          </button>
        </div>

        <div className="control-group">
          <span className="group-label">Grid</span>
          <button
            type="button"
            className={`ctrl-btn ${showGrid ? 'active' : ''}`}
            onClick={onToggleGrid}
          >
            Grid
          </button>
          <label className="grid-input">
            Cols
            <input
              type="number"
              min={2}
              max={24}
              value={gridColumns}
              onChange={(e) => onGridColumnsChange(Number(e.target.value))}
            />
          </label>
          <label className="grid-input">
            Rows
            <input
              type="number"
              min={2}
              max={24}
              value={gridRows}
              onChange={(e) => onGridRowsChange(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="control-group">
          <span className="group-label">Display</span>
          <select
            className="ctrl-select"
            value={displayMode}
            onChange={(e) => onDisplayModeChange(e.target.value as 'single' | 'all')}
          >
            <option value="single">Single Display</option>
            <option value="all">All Displays</option>
          </select>
          {displayMode === 'single' && (
            <select
              className="ctrl-select"
              value={selectedDisplayId ?? ''}
              onChange={(e) => onDisplaySelect(Number(e.target.value))}
            >
              {displays.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                  {d.isPrimary ? ' (Primary)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="control-group">
          <button
            type="button"
            className={`ctrl-btn ${showSplitIndicator ? 'active' : ''}`}
            onClick={onToggleSplitIndicator}
          >
            Split Preview
          </button>
          {mode === 'edit' ? (
            <button type="button" className="ctrl-btn primary" onClick={onEnterView}>
              Go Fullscreen
            </button>
          ) : (
            <button type="button" className="ctrl-btn" onClick={onExitView}>
              Exit View
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
