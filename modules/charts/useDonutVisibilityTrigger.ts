import { useCallback, useEffect, useRef } from "react";
import { Dimensions, type View } from "react-native";

import { useDonutVisibilityContext } from "@/modules/charts/DonutVisibilityContext";

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
    const frame = requestAnimationFrame(checkVisibility);
    return () => cancelAnimationFrame(frame);
  }, [checkVisibility, enabled, resetKey]);

  return { containerRef, checkVisibility };
}
