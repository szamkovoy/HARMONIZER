import { useCallback, useEffect, useRef } from "react";
import { Dimensions, type View } from "react-native";

import { useDonutVisibilityContext } from "@/modules/charts/DonutVisibilityContext";

const MIN_LAYOUT_HEIGHT = 8;
const VISIBILITY_POLL_MS = 200;
const VISIBILITY_POLL_WINDOW_MS = 3000;

export function useDonutVisibilityTrigger(
  onVisible: () => void,
  enabled: boolean,
  resetKey: string,
) {
  const context = useDonutVisibilityContext();
  const containerRef = useRef<View>(null);
  const hasTriggeredRef = useRef(false);

  useEffect(() => {
    hasTriggeredRef.current = false;
  }, [resetKey]);

  const checkVisibility = useCallback(() => {
    if (!enabled || hasTriggeredRef.current) return;
    containerRef.current?.measureInWindow((_x, y, _width, height) => {
      if (height < MIN_LAYOUT_HEIGHT) return;
      const windowHeight = Dimensions.get("window").height;
      if (y + height > 0 && y < windowHeight) {
        hasTriggeredRef.current = true;
        onVisible();
      }
    });
  }, [enabled, onVisible]);

  useEffect(() => {
    if (!context) return undefined;
    return context.register(checkVisibility);
  }, [checkVisibility, context]);

  useEffect(() => {
    if (!enabled) return undefined;
    checkVisibility();
    const frame = requestAnimationFrame(checkVisibility);
    const interval = setInterval(checkVisibility, VISIBILITY_POLL_MS);
    const stop = setTimeout(() => clearInterval(interval), VISIBILITY_POLL_WINDOW_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, [checkVisibility, enabled, resetKey]);

  const onLayout = useCallback(() => {
    requestAnimationFrame(checkVisibility);
  }, [checkVisibility]);

  return { containerRef, checkVisibility, onLayout };
}
