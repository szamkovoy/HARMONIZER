import { useCallback, useEffect, useRef } from "react";
import { Dimensions, type View } from "react-native";

import { useDonutVisibilityContext } from "@/modules/charts/DonutVisibilityContext";

const MIN_LAYOUT_HEIGHT = 8;
const MIN_VISIBLE_PX = 28;
const VISIBILITY_POLL_MS = 250;
const LAYOUT_SETTLE_MS = 120;

function visibleHeightInWindow(y: number, height: number) {
  const windowHeight = Dimensions.get("window").height;
  const top = Math.max(y, 0);
  const bottom = Math.min(y + height, windowHeight);
  return Math.max(0, bottom - top);
}

function isMeaningfullyVisible(y: number, height: number) {
  return visibleHeightInWindow(y, height) >= MIN_VISIBLE_PX;
}

export function useDonutVisibilityTrigger(options: {
  onVisible: () => void;
  enabled: boolean;
  resetKey: string;
  getProgress: () => number;
  onReset?: () => void;
  onViewportChange?: (visible: boolean) => void;
}) {
  const { onVisible, enabled, resetKey, getProgress, onReset, onViewportChange } = options;
  const context = useDonutVisibilityContext();
  const containerRef = useRef<View>(null);
  const hasRequestedRevealRef = useRef(false);
  const isInViewportRef = useRef(false);
  const layoutReadyRef = useRef(false);
  const layoutSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onVisibleRef = useRef(onVisible);
  const getProgressRef = useRef(getProgress);
  const onResetRef = useRef(onReset);
  const onViewportChangeRef = useRef(onViewportChange);

  onVisibleRef.current = onVisible;
  getProgressRef.current = getProgress;
  onResetRef.current = onReset;
  onViewportChangeRef.current = onViewportChange;

  useEffect(() => {
    hasRequestedRevealRef.current = false;
    isInViewportRef.current = false;
    layoutReadyRef.current = false;
    onResetRef.current?.();
  }, [resetKey]);

  const checkVisibility = useCallback(() => {
    if (!enabled) return;
    if (!layoutReadyRef.current) return;
    if (getProgressRef.current() >= 1) return;

    containerRef.current?.measureInWindow((_x, y, _width, height) => {
      if (height < MIN_LAYOUT_HEIGHT) return;

      const visible = isMeaningfullyVisible(y, height);
      if (visible !== isInViewportRef.current) {
        isInViewportRef.current = visible;
        onViewportChangeRef.current?.(visible);
      }

      if (!visible) {
        if (getProgressRef.current() <= 0) {
          hasRequestedRevealRef.current = false;
        }
        return;
      }

      if (hasRequestedRevealRef.current) return;

      hasRequestedRevealRef.current = true;
      onVisibleRef.current();
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

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(interval);
    };
  }, [checkVisibility, enabled, resetKey]);

  const onLayout = useCallback(() => {
    layoutReadyRef.current = false;
    if (layoutSettleTimerRef.current != null) {
      clearTimeout(layoutSettleTimerRef.current);
    }
    layoutSettleTimerRef.current = setTimeout(() => {
      layoutReadyRef.current = true;
      requestAnimationFrame(checkVisibility);
    }, LAYOUT_SETTLE_MS);
  }, [checkVisibility]);

  useEffect(
    () => () => {
      if (layoutSettleTimerRef.current != null) {
        clearTimeout(layoutSettleTimerRef.current);
      }
    },
    [],
  );

  return { containerRef, checkVisibility, onLayout, isInViewportRef };
}
