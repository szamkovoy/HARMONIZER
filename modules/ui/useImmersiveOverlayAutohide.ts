import { useCallback, useEffect, useRef, useState } from "react";

export function useImmersiveOverlayAutohide({
  autoHideMs = 4000,
  initialVisible = true,
}: {
  autoHideMs?: number;
  initialVisible?: boolean;
}) {
  const [overlayVisible, setOverlayVisible] = useState(initialVisible);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearOverlayTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleOverlayHide = useCallback(() => {
    clearOverlayTimer();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      setOverlayVisible(false);
    }, autoHideMs);
  }, [autoHideMs, clearOverlayTimer]);

  const showOverlay = useCallback(
    (persist = false) => {
      setOverlayVisible(true);
      if (persist) {
        clearOverlayTimer();
      } else {
        scheduleOverlayHide();
      }
    },
    [clearOverlayTimer, scheduleOverlayHide],
  );

  const hideOverlay = useCallback(() => {
    clearOverlayTimer();
    setOverlayVisible(false);
  }, [clearOverlayTimer]);

  const toggleOverlay = useCallback(() => {
    setOverlayVisible((current) => {
      const next = !current;
      if (next) {
        scheduleOverlayHide();
      } else {
        clearOverlayTimer();
      }
      return next;
    });
  }, [clearOverlayTimer, scheduleOverlayHide]);

  useEffect(() => clearOverlayTimer, [clearOverlayTimer]);

  return {
    overlayVisible,
    setOverlayVisible,
    clearOverlayTimer,
    scheduleOverlayHide,
    showOverlay,
    hideOverlay,
    toggleOverlay,
  };
}
