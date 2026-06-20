import { useEffect, useRef, useState } from 'react';
import type { VideoFile } from '../types/layout';

interface VideoTileProps {
  tileId: string;
  folderPath: string | null;
  videoIndex: number;
  isEditMode: boolean;
  isSelected: boolean;
  onSelect: (tileId: string) => void;
  onAssignFolder: (tileId: string) => void;
  onVideoIndexChange: (tileId: string, index: number) => void;
}

export function VideoTile({
  tileId,
  folderPath,
  videoIndex,
  isEditMode,
  isSelected,
  onSelect,
  onAssignFolder,
  onVideoIndexChange,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!folderPath || !window.electronAPI) {
      setVideos([]);
      return;
    }

    window.electronAPI.listVideos(folderPath).then(setVideos).catch(() => setVideos([]));
  }, [folderPath]);

  useEffect(() => {
    if (!videos.length) {
      setVideoUrl(null);
      return;
    }

    const index = ((videoIndex % videos.length) + videos.length) % videos.length;
    const video = videos[index];

    window.electronAPI
      .toFileUrl(video.path)
      .then(setVideoUrl)
      .catch(() => setError('Could not load video'));
  }, [videos, videoIndex]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    video.load();
    video.play().catch(() => {
      // Autoplay may be blocked until user interaction
    });
  }, [videoUrl]);

  const handleEnded = () => {
    if (videos.length > 1) {
      onVideoIndexChange(tileId, videoIndex + 1);
    } else {
      videoRef.current?.play();
    }
  };

  const folderLabel = folderPath
    ? folderPath.split(/[/\\]/).pop() ?? folderPath
    : null;

  return (
    <div
      className={`video-tile ${isSelected ? 'selected' : ''} ${isEditMode ? 'edit-mode' : ''}`}
      onClick={() => isEditMode && onSelect(tileId)}
    >
      {videoUrl ? (
        <video
          ref={videoRef}
          className="video-element"
          src={videoUrl}
          muted
          autoPlay
          playsInline
          loop={videos.length <= 1}
          onEnded={handleEnded}
          onError={() => setError('Playback error')}
        />
      ) : (
        <div className="video-placeholder">
          {error ? (
            <span className="placeholder-text error">{error}</span>
          ) : folderPath ? (
            <span className="placeholder-text">No videos in folder</span>
          ) : (
            <span className="placeholder-text">No folder assigned</span>
          )}
        </div>
      )}

      {isEditMode && (
        <div className="tile-overlay">
          <button
            type="button"
            className="tile-btn"
            onClick={(e) => {
              e.stopPropagation();
              onAssignFolder(tileId);
            }}
          >
            {folderLabel ? `📁 ${folderLabel}` : 'Assign Folder'}
          </button>
          {videos.length > 0 && (
            <span className="tile-meta">
              {(((videoIndex % videos.length) + videos.length) % videos.length) + 1} / {videos.length}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
