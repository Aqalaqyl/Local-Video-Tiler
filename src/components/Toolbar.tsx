import type { DisplayInfo } from '../hooks/useElectronAPI';

interface ToolbarProps {
  visible: boolean;
  editMode: boolean;
  showGrid: boolean;
  snapEnabled: boolean;
  gridDivisions: number;
  spanFullscreen: boolean;
  displays: DisplayInfo[];
  tileCount: number;
  onToggleEdit: () => void;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  onGridDivisionsChange: (n: number) => void;
  onToggleSpanFullscreen: () => void;
  onMoveToDisplay: (id: number) => void;
  onResetLayout: () => void;
}

export function Toolbar({
  visible,
  editMode,
  showGrid,
  snapEnabled,
  gridDivisions,
  spanFullscreen,
  displays,
  tileCount,
  onToggleEdit,
  onToggleGrid,
  onToggleSnap,
  onGridDivisionsChange,
  onToggleSpanFullscreen,
  onMoveToDisplay,
  onResetLayout,
}: ToolbarProps) {
  return (
    <div className={`toolbar ${visible ? 'visible' : 'hidden'}`}>
      <div className="toolbar-section">
        <span className="toolbar-brand">TileView</span>
        <span className="toolbar-meta">{tileCount} tile{tileCount !== 1 ? 's' : ''}</span>
      </div>

      <div className="toolbar-section toolbar-controls">
        <button
          type="button"
          className={editMode ? 'active' : ''}
          onClick={onToggleEdit}
          title="Toggle edit mode (E)"
        >
          {editMode ? '✓ Edit Mode' : 'Edit Layout'}
        </button>

        {editMode && (
          <>
            <button
              type="button"
              className={showGrid ? 'active' : ''}
              onClick={onToggleGrid}
              title="Toggle alignment grid (G)"
            >
              Grid
            </button>
            <button
              type="button"
              className={snapEnabled ? 'active' : ''}
              onClick={onToggleSnap}
              title="Toggle snap to grid (S)"
            >
              Snap
            </button>
            <label className="grid-divisions">
              <span>Divisions</span>
              <select
                value={gridDivisions}
                onChange={(e) => onGridDivisionsChange(Number(e.target.value))}
              >
                {[2, 3, 4, 5, 6, 8, 12].map((n) => (
                  <option key={n} value={n}>
                    {n}×{n}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <div className="toolbar-divider" />

        <button
          type="button"
          className={spanFullscreen ? 'active' : ''}
          onClick={onToggleSpanFullscreen}
          title="Fullscreen across all displays"
        >
          {spanFullscreen ? 'Exit Span' : 'Span All Displays'}
        </button>

        {displays.length > 1 && (
          <select
            className="display-select"
            onChange={(e) => onMoveToDisplay(Number(e.target.value))}
            defaultValue=""
            title="Move window to display"
          >
            <option value="" disabled>
              Move to display…
            </option>
            {displays.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} {d.isPrimary ? '(primary)' : ''} — {d.bounds.width}×{d.bounds.height}
              </option>
            ))}
          </select>
        )}

        <button type="button" onClick={onResetLayout} title="Reset to single tile">
          Reset
        </button>
      </div>

      {editMode && (
        <div className="toolbar-hint">
          Click to split vertically · Shift+click for horizontal · Hover to preview
        </div>
      )}
    </div>
  );
}
