import { useCallback, useEffect, useRef } from "react";
import { Dimensions, type View } from "react-native";

import { useDonutVisibilityContext } from "@/modules/charts/DonutVisibilityContext";

const MIN_LAYOUT_HEIGHT = 8;
const VISIBILITY_POLL_MS = 250;
const STUCK_VISIBLE_MS = 1800;
const ULTIMATE_REVEAL_MS = 5000;

function isInViewport(y: number, height: number) {
  const windowHeight = Dimensions.get("window").height;
  return y + height > 0 && y < windowHeight;
}

export function useDonutVisibilityTrigger(options: {
  onVisible: () => void;
  enabled: boolean;
  resetKey: string;
  getProgress: () => number;
  onReset?: () => void;
}) {
  const { onVisible, enabled, resetKey, getProgress, onReset } = options;
  const context = useDonutVisibilityContext();
  const containerRef = useRef<View>(null);
  const isVisibleRef = useRef(false);
  const visibleSinceRef = useRef<number | null>(null);
  const onVisibleRef = useRef(onVisible);
  const getProgressRef = useRef(getProgress);

  onVisibleRef.current = onVisible;
  getProgressRef.current = getProgress;

  useEffect(() => {
    isVisibleRef.current = false;
    visibleSinceRef.current = null;
    onReset?.();
  }, [onReset, resetKey]);

  const checkVisibility = useCallback(() => {
    if (!enabled) return;
    if (getProgressRef.current() >= 1) return;

    containerRef.current?.measureInWindow((_x, y, _width, height) => {
      if (height < MIN_LAYOUT_HEIGHT) return;

      const visible = isInViewport(y, height);
      isVisibleRef.current = visible;

      if (!visible) {
        visibleSinceRef.current = null;
        return;
      }

      if (visibleSinceRef.current == null) {
        visibleSinceRef.current = Date.now();
      }

      const progress = getProgressRef.current();
      if (progress < 0.001) {
        onVisibleRef.current();
        return;
      }

      const visibleForMs = Date.now() - visibleSinceRef.current;
      if (progress < 1 && visibleForMs >= STUCK_VISIBLE_MS) {
        onVisibleRef.current();
      }
    });
  }, [enabled]);

  useEffect(() => {
    if (!context) return undefined;
    return context.register(checkVisibility);
  }, [checkVisibility, context]);

  useEffect(() => {
    if (!enabled) return undefined;

    checkVisibility();
    const frame = requestAnimationFrame(checkVisibility);
    const interval = setInterval(() => {
      if (getProgressRef.current() >= 1) {
        clearInterval(interval);
        return;
      }
      checkVisibility();
    }, VISIBILITY_POLL_MS);

    const ultimate = setTimeout(() => {
      if (getProgressRef.current() < 1) {
        onVisibleRef.current();
      }
    }, ULTIMATE_REVEAL_MS);

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(interval);
      clearTimeout(ultimate);
    };
  }, [checkVisibility, enabled, resetKey]);

  const onLayout = useCallback(() => {
    requestAnimationFrame(checkVisibility);
  }, [checkVisibility]);

  return { containerRef, checkVisibility, onLayout };
}
