/**
 * BreathBpmSmoother: сглаживает «текущий BPM» для ритма дыхания, чтобы длительности вдоха и
 * выдоха не метались при дрожании детектора пульса.
 *
 * Зачем:
 *  - Когерентное дыхание (и будущие режимы) должны задавать вдох/выдох в **ударах сердца**,
 *    а не в секундах. Но подстраивать длительность цикла мгновенно под каждое колебание
 *    детектированного BPM нельзя — получится неприятное «рыскание» темпа.
 *  - При реальных физиологических сменах BPM (например, при вдохе учащение пульса) — мы
 *    хотим, чтобы темп плавно следовал, но без скачков.
 *
 * Алгоритм:
 *  - Вход: `targetBpm` (последнее «сырое» значение от движка пульса) и `dtMs`.
 *  - Выход: `smoothedBpm`, экспоненциально приближающийся к target со временем жизни ~60 с
 *    (по ТЗ: «при скачке — переходить плавно в течение минуты»).
 *  - Если разница с target ≤ BPM_LOCK_EPS (1 BPM) — квантование: смотрим значение как есть,
 *    чтобы не «вечно догонять».
 *
 * Для мгновенного старта (первое значение) используется `seed(bpm)`: обходит сглаживание
 * и ставит smoothed = target, чтобы практика не стартовала на стандартных 60 BPM.
 */

export const BREATH_BPM_SMOOTHER_TAU_MS = 60_000;
const BPM_LOCK_EPS = 1;

export class BreathBpmSmoother {
  private currentBpm = 0;

  seed(bpm: number): void {
    if (bpm > 0) this.currentBpm = bpm;
  }

  reset(): void {
    this.currentBpm = 0;
  }

  /**
   * Продвинуть сглаженный BPM к `targetBpm` на шаг `dtMs`.
   *
   * Для линейного ramp (dBpm/dt = const, достигает таргета за 60 с) достаточно:
   *   maxDelta = |Δ| * dtMs / TAU
   * Это даёт ровно 60 с на покрытие любой разницы, что соответствует ТЗ.
   */
  step(targetBpm: number, dtMs: number): number {
    if (!(targetBpm > 0)) return this.currentBpm;
    if (this.currentBpm <= 0) {
      this.currentBpm = targetBpm;
      return this.currentBpm;
    }
    const diff = targetBpm - this.currentBpm;
    if (Math.abs(diff) <= BPM_LOCK_EPS) {
      this.currentBpm = targetBpm;
      return this.currentBpm;
    }
    const maxDelta = (Math.abs(diff) * Math.max(0, dtMs)) / BREATH_BPM_SMOOTHER_TAU_MS;
    if (maxDelta >= Math.abs(diff)) {
      this.currentBpm = targetBpm;
    } else {
      this.currentBpm += Math.sign(diff) * maxDelta;
    }
    return this.currentBpm;
  }

  get value(): number {
    return this.currentBpm;
  }
}
