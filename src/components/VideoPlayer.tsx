import { useEffect, useRef, useState, useCallback } from 'react';
import { useElectronAPI } from '../hooks/useElectronAPI';

interface VideoPlayerProps {
  videoPath: string | null;
  onEnded?: () => void;
  muted?: boolean;
}

export function VideoPlayer({ videoPath, onEnded, muted = false }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const { toFileUrl } = useElectronAPI();

  useEffect(() => {
    if (!videoPath) {
      setSrc(null);
      return;
    }
    setError(false);
    toFileUrl(videoPath).then(setSrc);
  }, [videoPath, toFileUrl]);

  const handleError = useCallback(() => setError(true), []);

  if (!videoPath) {
    return (
      <div className="video-empty">
        <span className="video-empty-icon">▶</span>
        <span>No video selected</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="video-empty video-error">
        <span>Unable to play this file</span>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      className="video-player"
      src={src ?? undefined}
      controls
      autoPlay
      muted={muted}
      onEnded={onEnded}
      onError={handleError}
      playsInline
    />
  );
}
