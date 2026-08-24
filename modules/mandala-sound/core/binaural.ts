/**
 * Мультиполосный кроссфейд binaural-loop'ов.
 *
 * `binauralBeats` — частоты биения доступных loop'ов, отсортированные по
 * убыванию (12 → 2 Гц). Для текущего `targetHz` выбираются два соседних
 * loop'а, между которыми лежит частота, и их громкости интерполируются так,
 * чтобы сумма активных gain'ов = 1. Остальные loop'ы заглушены.
 *
 * Это даёт «почти непрерывное» скольжение бинаурального биения вслед за
 * сигмоидой `targetHz` (шаг ~1 Гц + кроссфейд), вместо 4 дискретных полос.
 * Несущая фиксирована 150 Гц (рекомендованная PDF база); медленная модуляция
 * 140–180 Гц не реализована (30-сек луп не кодирует 45-сек период) — см.
 * `docs/04_workspace/open_questions.md`. Лупы по 30 с (было 4 с) — чтобы
 * микро-пауза ExoPlayer `REPEAT_MODE_ONE` на стыке была редкой (раз в 30 с,
 * на громкости 0.075 под дроном — практически неслышна), а не каждые 4 с.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function binauralCrossfadeGains(
  targetHz: number,
  binauralBeats: readonly number[],
): number[] {
  const n = binauralBeats.length;
  const gains = new Array<number>(n).fill(0);
  if (n === 0) return gains;

  const hi = binauralBeats[0]!;
  const lo = binauralBeats[n - 1]!;
  const f = clamp(targetHz, lo, hi);

  for (let i = 0; i < n - 1; i += 1) {
    const upper = binauralBeats[i]!;
    const lower = binauralBeats[i + 1]!;
    if (f >= lower && f <= upper) {
      if (upper === lower) {
        gains[i] = 1;
        return gains;
      }
      const frac = (upper - f) / (upper - lower); // 0 на upper, 1 на lower
      gains[i] = 1 - frac;
      gains[i + 1] = frac;
      return gains;
    }
  }

  // На краях диапазона (после clamp) — один активный loop.
  if (f >= hi) {
    gains[0] = 1;
  } else {
    gains[n - 1] = 1;
  }
  return gains;
}
