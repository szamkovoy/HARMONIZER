import { useCallback, useEffect, useRef, useState } from "react";

import { DONUT_ANIMATION_MS } from "@/modules/charts/constants";
import { easeOutCubic } from "@/modules/charts/donutGeometry";

export function useDonutAnimation() {
  const [progress, setProgress] = useState(0);
  const frameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    startTimeRef.current = null;
  }, []);

  const start = useCallback(() => {
    cancel();
    setProgress(0);
    const tick = (now: number) => {
      if (startTimeRef.current == null) startTimeRef.current = now;
      const raw = Math.min(1, (now - startTimeRef.current) / DONUT_ANIMATION_MS);
      setProgress(easeOutCubic(raw));
      if (raw < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
        setProgress(1);
      }
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [cancel]);

  const reset = useCallback(() => {
    cancel();
    setProgress(0);
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  return { progress, start, reset };
}
