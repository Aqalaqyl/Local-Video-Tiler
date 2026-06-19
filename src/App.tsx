import { useState, useEffect, useCallback, useRef } from 'react';
import type { TileNode, AppSettings } from './types/layout';
import {
  createDefaultLayout,
  updateLeaf,
  removeTile,
  countLeaves,
} from './utils/layoutTree';
import { TileWorkspace } from './components/TileWorkspace';
import { Toolbar } from './components/Toolbar';
import { useAutoHide } from './hooks/useAutoHide';
import { useElectronAPI, useDisplays } from './hooks/useElectronAPI';
import './styles/app.css';

const DEFAULT_SETTINGS: AppSettings = {
  editMode: false,
  showGrid: false,
  snapEnabled: true,
  gridDivisions: 4,
  uiVisible: true,
  spanFullscreen: false,
  activeDisplayId: null,
};

interface PersistedState {
  layout: TileNode;
  settings: Partial<AppSettings>;
}

export default function App() {
  const [layout, setLayout] = useState<TileNode>(createDefaultLayout);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    saveLayout,
    loadLayout,
    enterSpanFullscreen,
    exitSpanFullscreen,
    moveToDisplay,
    isElectron,
  } = useElectronAPI();
  const displays = useDisplays();

  const { visible: uiVisible, show: showUI } = useAutoHide(!settings.editMode);

  useEffect(() => {
    loadLayout().then((data) => {
      if (data) {
        try {
          const parsed: PersistedState = JSON.parse(data);
          if (parsed.layout) setLayout(parsed.layout);
          if (parsed.settings) {
            setSettings((s) => ({ ...s, ...parsed.settings, editMode: false }));
          }
        } catch {
          // ignore corrupt layout
        }
      }
      setLoaded(true);
    });
  }, [loadLayout]);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const state: PersistedState = {
        layout,
        settings: {
          showGrid: settings.showGrid,
          snapEnabled: settings.snapEnabled,
          gridDivisions: settings.gridDivisions,
        },
      };
      saveLayout(JSON.stringify(state));
    }, 500);
  }, [layout, settings, loaded, saveLayout]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const handleAssignFolder = useCallback((tileId: string, folderPath: string) => {
    setLayout((l) => updateLeaf(l, tileId, { folderPath, selectedVideo: null }));
  }, []);

  const handleSelectVideo = useCallback((tileId: string, videoPath: string) => {
    setLayout((l) => updateLeaf(l, tileId, { selectedVideo: videoPath }));
  }, []);

  const handleRemoveTile = useCallback((tileId: string) => {
    setLayout((l) => removeTile(l, tileId));
  }, []);

  const handleToggleSpanFullscreen = useCallback(async () => {
    if (settings.spanFullscreen) {
      await exitSpanFullscreen();
      updateSettings({ spanFullscreen: false });
    } else {
      await enterSpanFullscreen();
      updateSettings({ spanFullscreen: true });
    }
  }, [settings.spanFullscreen, enterSpanFullscreen, exitSpanFullscreen, updateSettings]);

  const handleResetLayout = useCallback(() => {
    setLayout(createDefaultLayout());
    updateSettings({ editMode: false });
  }, [updateSettings]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      showUI();
      switch (e.key.toLowerCase()) {
        case 'e':
          updateSettings({ editMode: !settings.editMode });
          break;
        case 'g':
          if (settings.editMode) updateSettings({ showGrid: !settings.showGrid });
          break;
        case 's':
          if (settings.editMode) updateSettings({ snapEnabled: !settings.snapEnabled });
          break;
        case 'escape':
          if (settings.editMode) updateSettings({ editMode: false });
          else if (settings.spanFullscreen) handleToggleSpanFullscreen();
          break;
        case 'f':
          if (e.metaKey || e.ctrlKey) return;
          handleToggleSpanFullscreen();
          break;
      }
    };

    const onMouseMove = () => showUI();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousemove', onMouseMove);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [settings, updateSettings, showUI, handleToggleSpanFullscreen]);

  if (!loaded) {
    return <div className="loading">Loading…</div>;
  }

  return (
    <div className={`app ${settings.editMode ? 'edit-active' : ''}`}>
      <Toolbar
        visible={uiVisible || settings.editMode}
        editMode={settings.editMode}
        showGrid={settings.showGrid}
        snapEnabled={settings.snapEnabled}
        gridDivisions={settings.gridDivisions}
        spanFullscreen={settings.spanFullscreen}
        displays={displays}
        tileCount={countLeaves(layout)}
        onToggleEdit={() => updateSettings({ editMode: !settings.editMode })}
        onToggleGrid={() => updateSettings({ showGrid: !settings.showGrid })}
        onToggleSnap={() => updateSettings({ snapEnabled: !settings.snapEnabled })}
        onGridDivisionsChange={(n) => updateSettings({ gridDivisions: n })}
        onToggleSpanFullscreen={handleToggleSpanFullscreen}
        onMoveToDisplay={moveToDisplay}
        onResetLayout={handleResetLayout}
      />

      <TileWorkspace
        layout={layout}
        editMode={settings.editMode}
        showGrid={settings.showGrid}
        snapEnabled={settings.snapEnabled}
        gridDivisions={settings.gridDivisions}
        onLayoutChange={setLayout}
        onAssignFolder={handleAssignFolder}
        onSelectVideo={handleSelectVideo}
        onRemoveTile={handleRemoveTile}
        onActivity={showUI}
      />

      {!isElectron && (
        <div className="dev-banner">
          Run with <code>npm run electron:dev</code> for full desktop features
        </div>
      )}
    </div>
  );
}
