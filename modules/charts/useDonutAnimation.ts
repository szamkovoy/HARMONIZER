import { useCallback, useEffect, useRef, useState } from "react";

import { DONUT_ANIMATION_MS } from "@/modules/charts/constants";
import { easeOutCubic } from "@/modules/charts/donutGeometry";

export function useDonutAnimation() {
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  const setProgressSafe = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    progressRef.current = clamped;
    setProgress(clamped);
  }, []);

  const cancel = useCallback(() => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    startTimeRef.current = null;
  }, []);

  const start = useCallback(() => {
    cancel();
    setProgressSafe(0);
    const tick = (now: number) => {
      if (startTimeRef.current == null) startTimeRef.current = now;
      const raw = Math.min(1, (now - startTimeRef.current) / DONUT_ANIMATION_MS);
      setProgressSafe(easeOutCubic(raw));
      if (raw < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
        setProgressSafe(1);
      }
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [cancel, setProgressSafe]);

  const complete = useCallback(() => {
    cancel();
    setProgressSafe(1);
  }, [cancel, setProgressSafe]);

  const reset = useCallback(() => {
    cancel();
    setProgressSafe(0);
  }, [cancel, setProgressSafe]);

  useEffect(() => cancel, [cancel]);

  return { progress, progressRef, start, reset, complete };
};
