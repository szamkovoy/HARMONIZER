/**
 * EmulatedPulseSensor: синтетический «пульс без датчика», нужен когда пользователь запускает
 * дыхательную практику без пальца на камере / Apple Watch / BLE HR.
 *
 * Кривая BPM (по требованию, апрель 2026):
 *   - Первые 3 минуты: монотонно падает с 75 до 65 BPM (релакс-модель).
 *   - Дальше: константа 65 BPM.
 *
 * Используется **только** для того, чтобы модуль Breath строил вдохи/выдохи «по ударам»,
 * а модуль Mandala — синхронно мерцал. **HRV, Баевский, когерентность и RSA при эмуляции
 * принудительно withheld** (см. pipeline.isPulseEmulated → UI скрывает эти метрики).
 *
 * Никакого «шума» вокруг RR: эмулятор детерминирован; если в будущем понадобится RSA-подобная
 * модуляция ради демо — добавим отдельную функцию с явным флагом.
 */

export const EMULATED_PULSE_START_BPM = 75;
export const EMULATED_PULSE_END_BPM = 65;
export const EMULATED_PULSE_RAMP_DURATION_MS = 3 * 60 * 1000;

/**
 * Текущий целевой BPM на момент `sinceStartMs` от старта эмуляции.
 * Линейная интерполяция 75 → 65 за 180 с, затем плато 65.
 */
export function emulatedBpmAt(sinceStartMs: number): number {
  if (sinceStartMs <= 0) {
    return EMULATED_PULSE_START_BPM;
  }
  if (sinceStartMs >= EMULATED_PULSE_RAMP_DURATION_MS) {
    return EMULATED_PULSE_END_BPM;
  }
  const t = sinceStartMs / EMULATED_PULSE_RAMP_DURATION_MS;
  return EMULATED_PULSE_START_BPM + (EMULATED_PULSE_END_BPM - EMULATED_PULSE_START_BPM) * t;
}

/**
 * Сгенерировать метки ударов от `fromMs` до `toMs` по эмулированной кривой.
 *
 * Алгоритм: накапливаем фазу ∫BPM(t) dt; когда прирост ≥ 1 удара — эмитим удар.
 * Это корректно обрабатывает плавный ramp (интеграл, а не RR последнего шага).
 */
export function generateEmulatedPulseBeats(
  emulationStartMs: number,
  fromMs: number,
  toMs: number,
  phaseAtFrom: number,
): { beats: number[]; phaseAtTo: number } {
  if (toMs <= fromMs) {
    return { beats: [], phaseAtTo: phaseAtFrom };
  }
  const beats: number[] = [];
  const STEP_MS = 50;
  let prevPhase = phaseAtFrom;
  let t = fromMs;
  while (t < toMs) {
    const tNext = Math.min(t + STEP_MS, toMs);
    const bpmMid = emulatedBpmAt(((t + tNext) / 2) - emulationStartMs);
    const dPhase = (bpmMid / 60000) * (tNext - t);
    const newPhase = prevPhase + dPhase;
    // Сколько целых «ударов» пересекли между prevPhase и newPhase.
    const prevFloor = Math.floor(prevPhase);
    const newFloor = Math.floor(newPhase);
    for (let k = prevFloor + 1; k <= newFloor; k += 1) {
      // Линейно найти момент, когда phase == k.
      const frac = (k - prevPhase) / Math.max(1e-6, newPhase - prevPhase);
      const beatMs = t + (tNext - t) * frac;
      beats.push(Math.round(beatMs));
    }
    prevPhase = newPhase;
    t = tNext;
  }
  return { beats, phaseAtTo: prevPhase };
}
