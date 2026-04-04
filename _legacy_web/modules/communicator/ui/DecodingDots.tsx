"use client";

import { useEffect, useState } from "react";

/** Анимация точек 1…5 по циклу. */
export function DecodingDots() {
  const [n, setN] = useState(1);

  useEffect(() => {
    const id = window.setInterval(() => {
      setN((x) => (x >= 5 ? 1 : x + 1));
    }, 280);
    return () => window.clearInterval(id);
  }, []);

  return <span aria-hidden>{".".repeat(n)}</span>;
}
