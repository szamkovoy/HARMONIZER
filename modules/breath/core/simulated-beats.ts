/**
 * Синтетические метки ударов для Expo Go (без нативной камеры): RR модулируется «дыханием» ~0.1 Гц.
 */
export function generateSimulatedBeatTimestamps(startMs: number, endMs: number): number[] {
  const beats: number[] = [];
  let t = startMs;
  while (t < endMs) {
    const phase = ((t - startMs) / 10_000) * Math.PI * 2;
    const rr = 820 + 48 * Math.sin(phase) + 12 * Math.sin((t - startMs) * 0.0023);
    t += Math.max(400, Math.min(1400, rr));
    if (t <= endMs) {
      beats.push(Math.round(t));
    }
  }
  return beats;
}
