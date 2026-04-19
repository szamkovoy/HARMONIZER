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
  /** Начальный fallback для inhaleMs при BPM=60 (используется пока smoother не заселился). */
  inhaleMs: number;
  /** Начальный fallback для exhaleMs при BPM=60. */
  exhaleMs: number;
  /** Число ударов сердца на вдохе (новая парадигма beat-driven). */
  inhaleBeats: number;
  /** Число ударов сердца на выдохе. */
  exhaleBeats: number;
}

export const DEFAULT_COHERENCE_TEST_TIMING: CoherenceBreathTiming = {
  totalMs: 120_000,
  instructionPhaseMs: 20_000,
  gongBeforeEndMs: 10_000,
  dimBeforeEndMs: 5000,
  inhaleMs: 5000,
  exhaleMs: 5000,
  inhaleBeats: 5,
  exhaleBeats: 5,
};
