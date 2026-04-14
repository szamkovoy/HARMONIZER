export type BreathPracticePhase = "idle" | "running" | "results";

export interface CoherenceBreathTiming {
  /** Полная длительность тестовой сессии (мс). */
  totalMs: number;
  /** Фаза текста: два цикла 5+5+5+5 (мс). */
  instructionPhaseMs: number;
  /** Гонг за столько мс до конца. */
  gongBeforeEndMs: number;
  /** Затемнение начинается за столько мс до конца. */
  dimBeforeEndMs: number;
  inhaleMs: number;
  exhaleMs: number;
}

export const DEFAULT_COHERENCE_TEST_TIMING: CoherenceBreathTiming = {
  totalMs: 120_000,
  instructionPhaseMs: 20_000,
  gongBeforeEndMs: 10_000,
  dimBeforeEndMs: 5000,
  inhaleMs: 5000,
  exhaleMs: 5000,
};
