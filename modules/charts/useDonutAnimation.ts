import { useCallback, useEffect, useRef, useState } from "react";

import { DONUT_ANIMATION_MS } from "@/modules/charts/constants";
import { easeOutCubic } from "@/modules/charts/donutGeometry";

const TICK_MS = 16;

export function useDonutAnimation() {
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const isAnimatingRef = useRef(false);

  const setProgressSafe = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    progressRef.current = clamped;
    setProgress(clamped);
  }, []);

  const cancel = useCallback(() => {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    startTimeRef.current = null;
    isAnimatingRef.current = false;
  }, []);

  const start = useCallback(() => {
    cancel();
    isAnimatingRef.current = true;
    setProgressSafe(0);
    startTimeRef.current = Date.now();

    const tick = () => {
      if (startTimeRef.current == null) return;
      const raw = Math.min(1, (Date.now() - startTimeRef.current) / DONUT_ANIMATION_MS);
      setProgressSafe(easeOutCubic(raw));
      if (raw >= 1) {
        cancel();
        setProgressSafe(1);
      }
    };

    tick();
    intervalRef.current = setInterval(tick, TICK_MS);
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
