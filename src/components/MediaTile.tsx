import { useState, useEffect, useCallback } from 'react';
import type { TileLeaf } from '../types/layout';
import { VideoPlayer } from './VideoPlayer';
import { useElectronAPI } from '../hooks/useElectronAPI';

interface MediaTileProps {
  tile: TileLeaf;
  editMode: boolean;
  onAssignFolder: (tileId: string, folderPath: string) => void;
  onSelectVideo: (tileId: string, videoPath: string) => void;
  onRemove: (tileId: string) => void;
}

export function MediaTile({
  tile,
  editMode,
  onAssignFolder,
  onSelectVideo,
  onRemove,
}: MediaTileProps) {
  const { selectFolder, listVideos } = useElectronAPI();
  const [videos, setVideos] = useState<string[]>([]);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!tile.folderPath) {
      setVideos([]);
      return;
    }
    listVideos(tile.folderPath).then((v) => {
      setVideos(v);
      if (tile.selectedVideo) {
        const idx = v.indexOf(tile.selectedVideo);
        if (idx >= 0) setCurrentIndex(idx);
      }
    });
  }, [tile.folderPath, tile.selectedVideo, listVideos]);

  const handlePickFolder = useCallback(async () => {
    const folder = await selectFolder();
    if (folder) onAssignFolder(tile.id, folder);
  }, [selectFolder, onAssignFolder, tile.id]);

  const handleSelectVideo = useCallback(
    (path: string, index: number) => {
      setCurrentIndex(index);
      onSelectVideo(tile.id, path);
      setShowPlaylist(false);
    },
    [onSelectVideo, tile.id]
  );

  const handleEnded = useCallback(() => {
    if (videos.length === 0) return;
    const next = (currentIndex + 1) % videos.length;
    setCurrentIndex(next);
    onSelectVideo(tile.id, videos[next]);
  }, [videos, currentIndex, onSelectVideo, tile.id]);

  const currentVideo = tile.selectedVideo ?? (videos.length > 0 ? videos[currentIndex] : null);
  const folderName = tile.folderPath?.split(/[/\\]/).pop() ?? null;

  return (
    <div className={`media-tile ${editMode ? 'edit-mode' : ''}`}>
      <VideoPlayer videoPath={currentVideo} onEnded={handleEnded} />

      <div className={`tile-overlay ${editMode ? 'visible' : ''}`}>
        {folderName && (
          <span className="tile-folder-label" title={tile.folderPath ?? ''}>
            {folderName}
          </span>
        )}
        <div className="tile-actions" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={handlePickFolder} title="Assign folder">
            📁
          </button>
          {videos.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPlaylist((s) => !s)}
              title="Playlist"
            >
              ☰ {videos.length}
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(tile.id)}
            title="Remove tile"
            className="danger"
          >
            ✕
          </button>
        </div>
      </div>

      {showPlaylist && videos.length > 0 && (
        <div className="playlist-panel" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <div className="playlist-header">Videos ({videos.length})</div>
          <ul>
            {videos.map((v, i) => {
              const name = v.split(/[/\\]/).pop() ?? v;
              return (
                <li key={v}>
                  <button
                    type="button"
                    className={i === currentIndex ? 'active' : ''}
                    onClick={() => handleSelectVideo(v, i)}
                  >
                    {name}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
