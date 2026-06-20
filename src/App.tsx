import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DisplayInfo, LayoutNode } from './types/layout';
import {
  createDefaultLayout,
  splitTile,
  updateSplitRatio,
  updateTileFolder,
  updateTileVideoIndex,
  removeTile,
  collectTiles,
} from './utils/layoutTree';
import { LayoutRenderer } from './components/LayoutRenderer';
import { SplitHandles } from './components/SplitHandles';
import { GridOverlay } from './components/GridOverlay';
import { SplitIndicator } from './components/SplitIndicator';
import { Controls } from './components/Controls';
import { useAutoHide } from './hooks/useAutoHide';
import './styles/app.css';

function parseViewParams(): {
  isViewWindow: boolean;
  displayMode: 'single' | 'all';
  viewport?: {
    offsetX: number;
    offsetY: number;
    offsetW: number;
    offsetH: number;
    combinedW: number;
    combinedH: number;
  };
} {
  const params = new URLSearchParams(window.location.search);
  if (params.get('view') !== '1') {
    return { isViewWindow: false, displayMode: 'single' };
  }

  return {
    isViewWindow: true,
    displayMode: (params.get('displayMode') as 'single' | 'all') || 'single',
    viewport: {
      offsetX: Number(params.get('offsetX') ?? 0),
      offsetY: Number(params.get('offsetY') ?? 0),
      offsetW: Number(params.get('offsetW') ?? window.innerWidth),
      offsetH: Number(params.get('offsetH') ?? window.innerHeight),
      combinedW: Number(params.get('combinedW') ?? window.innerWidth),
      combinedH: Number(params.get('combinedH') ?? window.innerHeight),
    },
  };
}

function loadLayoutFromStorage(): LayoutNode {
  try {
    const saved = localStorage.getItem('lvt-layout');
    if (saved) return JSON.parse(saved) as LayoutNode;
  } catch {
    // ignore
  }
  return createDefaultLayout();
}

export default function App() {
  const viewParams = useMemo(() => parseViewParams(), []);
  const [layout, setLayout] = useState<LayoutNode>(loadLayoutFromStorage);
  const [mode, setMode] = useState<'edit' | 'view'>('edit');
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [gridColumns, setGridColumns] = useState(12);
  const [gridRows, setGridRows] = useState(8);
  const [showSplitIndicator, setShowSplitIndicator] = useState(true);
  const [displayMode, setDisplayMode] = useState<'single' | 'all'>('single');
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [selectedDisplayId, setSelectedDisplayId] = useState<number | null>(null);

  const isViewWindow = viewParams.isViewWindow;
  const autoHideEnabled = mode === 'view' || isViewWindow;
  const { visible: controlsVisible } = useAutoHide(autoHideEnabled);

  const persistLayout = useCallback((next: LayoutNode) => {
    setLayout(next);
    localStorage.setItem('lvt-layout', JSON.stringify(next));
    window.electronAPI?.saveLayout(next);
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;

    const loadSaved = async () => {
      const saved = await window.electronAPI.loadLayout();
      if (saved) {
        setLayout(saved);
        localStorage.setItem('lvt-layout', JSON.stringify(saved));
      }
    };

    loadSaved();

    window.electronAPI.getDisplays().then((list) => {
      setDisplays(list);
      const primary = list.find((d) => d.isPrimary) ?? list[0];
      setSelectedDisplayId(primary?.id ?? null);
    });

    const unsubView = window.electronAPI.onViewModeChanged((inView) => {
      setMode(inView ? 'view' : 'edit');
      if (inView) setShowSplitIndicator(true);
    });

    return () => unsubView();
  }, []);

  useEffect(() => {
    if (isViewWindow) {
      setMode('view');
      setShowSplitIndicator(true);
    }
  }, [isViewWindow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.electronAPI?.exitViewMode();
        setMode('edit');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleAssignFolder = async (tileId: string) => {
    const folder = await window.electronAPI?.selectFolder();
    if (folder) {
      persistLayout(updateTileFolder(layout, tileId, folder));
    }
  };

  const handleSplit = (direction: 'horizontal' | 'vertical') => {
    if (!selectedTileId) return;
    const next = splitTile(layout, selectedTileId, direction);
    persistLayout(next);
    const tiles = collectTiles(next);
    const newTile = tiles.find((t) => t.tile.id !== selectedTileId);
    if (newTile) setSelectedTileId(newTile.tile.id);
  };

  const handleRemoveTile = () => {
    if (!selectedTileId) return;
    const next = removeTile(layout, selectedTileId);
    persistLayout(next);
    const remaining = collectTiles(next);
    setSelectedTileId(remaining[0]?.tile.id ?? null);
  };

  const handleEnterView = async () => {
    setShowSplitIndicator(true);
    await window.electronAPI?.saveLayout(layout);
    window.electronAPI?.enterViewMode(
      displayMode,
      displayMode === 'single' ? selectedDisplayId ?? undefined : undefined
    );
  };

  const handleExitView = () => {
    window.electronAPI?.exitViewMode();
    setMode('edit');
  };

  const isEditMode = mode === 'edit' && !isViewWindow;
  const viewport = viewParams.viewport;

  const layoutContent = (
    <>
      <LayoutRenderer
        node={layout}
        isEditMode={isEditMode}
        selectedTileId={selectedTileId}
        onSelectTile={setSelectedTileId}
        onAssignFolder={handleAssignFolder}
        onVideoIndexChange={(tileId, index) =>
          persistLayout(updateTileVideoIndex(layout, tileId, index))
        }
      />

      {isEditMode && (
        <>
          <GridOverlay columns={gridColumns} rows={gridRows} visible={showGrid} />
          <SplitHandles
            layout={layout}
            showGrid={showGrid}
            gridColumns={gridColumns}
            gridRows={gridRows}
            onRatioChange={(splitId, ratio) =>
              persistLayout(updateSplitRatio(layout, splitId, ratio))
            }
          />
        </>
      )}

      <SplitIndicator
        layout={layout}
        visible={showSplitIndicator && (mode === 'view' || isViewWindow)}
        displays={displays}
        displayMode={isViewWindow ? viewParams.displayMode : displayMode}
        viewport={viewport}
      />
    </>
  );

  return (
    <div className={`app ${isViewWindow ? 'view-window' : ''} ${mode}`}>
      <div className="canvas">
        {isViewWindow && viewport ? (
          <div
            className="viewport-clip"
            style={{
              width: `${(viewport.combinedW / viewport.offsetW) * 100}%`,
              height: `${(viewport.combinedH / viewport.offsetH) * 100}%`,
              left: `${-(viewport.offsetX / viewport.combinedW) * (viewport.combinedW / viewport.offsetW) * 100}%`,
              top: `${-(viewport.offsetY / viewport.combinedH) * (viewport.combinedH / viewport.offsetH) * 100}%`,
            }}
          >
            <div className="layout-root">{layoutContent}</div>
          </div>
        ) : (
          <div className="layout-root">{layoutContent}</div>
        )}
      </div>

      <Controls
        visible={controlsVisible}
        mode={mode}
        isViewWindow={isViewWindow}
        showGrid={showGrid}
        showSplitIndicator={showSplitIndicator}
        gridColumns={gridColumns}
        gridRows={gridRows}
        displayMode={displayMode}
        displays={displays}
        selectedDisplayId={selectedDisplayId}
        selectedTileId={selectedTileId}
        onToggleGrid={() => setShowGrid((v) => !v)}
        onToggleSplitIndicator={() => setShowSplitIndicator((v) => !v)}
        onGridColumnsChange={(n) => setGridColumns(Math.max(2, Math.min(24, n)))}
        onGridRowsChange={(n) => setGridRows(Math.max(2, Math.min(24, n)))}
        onSplitHorizontal={() => handleSplit('horizontal')}
        onSplitVertical={() => handleSplit('vertical')}
        onRemoveTile={handleRemoveTile}
        onEnterView={handleEnterView}
        onExitView={handleExitView}
        onDisplayModeChange={setDisplayMode}
        onDisplaySelect={setSelectedDisplayId}
      />

      {isEditMode && !selectedTileId && (
        <div className="hint">Click a tile to select it, then split or assign a video folder.</div>
      )}
    </div>
  );
}
