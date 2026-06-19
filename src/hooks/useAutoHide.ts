import { useState, useEffect, useCallback, useRef } from 'react';

const HIDE_DELAY_MS = 2500;

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
    show();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, show]);

  return { visible, show, hide };
}
