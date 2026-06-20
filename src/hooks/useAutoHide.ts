import { useCallback, useEffect, useRef, useState } from 'react';

const HIDE_DELAY_MS = 3000;

export function useAutoHide(enabled: boolean) {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (enabled) {
      timerRef.current = setTimeout(() => setVisible(false), HIDE_DELAY_MS);
    }
  }, [enabled]);

  const hide = useCallback(() => {
    if (enabled) setVisible(false);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setVisible(true);
      return;
    }

    const onMove = () => show();
    const onKey = () => show();

    window.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onKey);
    show();

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onKey);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, show]);

  return { visible, show, hide };
}
