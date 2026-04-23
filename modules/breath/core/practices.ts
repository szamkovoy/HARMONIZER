/**
 * Каталог дыхательных практик.
 *
 * Каждая практика описывается дескриптором: какой `BreathPhaseShape` построить из
 * пользовательского базового числа ударов, какой визуальный индикатор показать, какой
 * у неё канал (общий/левая/правая/попеременные ноздри) и какое «нормальное» число
 * ударов (для подсветки на панели).
 *
 * Названия (главное + санскрит) берутся из i18n — каталог сам не локализуется.
 *
 * Добавление новой практики: дописать id в `BreathPracticeId` (в i18n), добавить
 * локализованные строки и сюда — дескриптор. Ни один экран/индикатор не должен
 * хардкодить специфику практик.
 */
import type { BreathPracticeId } from "@/modules/breath/i18n/coherence";
import type {
  BreathChannel,
  BreathPhaseShape,
} from "@/modules/breath/core/breath-phase-planner";

/**
 * Какой индикатор использовать. Индикатор сам решает, какую часть плана цикла
 * отрисовать (мы передаём ему `PlannedCycle` и время в цикле целиком).
 */
export type BreathIndicatorKind =
  | "bar" // одиночный вертикальный столбик (когерентное дыхание)
  | "dual-bar" // два тонких столбика (канальные дыхания)
  | "square" // квадрат вокруг мандалы
  | "triangle-up" // треугольник вершиной вверх
  | "triangle-down"; // треугольник вершиной вниз

export interface BreathPracticeDescriptor {
  id: BreathPracticeId;
  indicatorKind: BreathIndicatorKind;
  /** Основной канал/режим ноздрей для индикатора и дальнейших текстов. */
  channelMode: "both" | "left" | "right" | "alternating";
  /**
   * Построить `BreathPhaseShape` для заданного базового числа ударов.
   * На вход идёт N — «базовая фаза» (чаще всего вдох), остальные фазы масштабируются
   * пропорционально по правилу конкретной практики.
   */
  buildShape: (baseBeats: number) => BreathPhaseShape;
  /** «Нормальное» значение базового числа (для подсветки акцентом на панели). */
  normalBaseBeats: number;
  /** Мин/макс значения base beats, которые может выставить пользователь. */
  minBaseBeats: number;
  maxBaseBeats: number;
}

function equalPair(
  kind1: "inhale" | "exhale",
  kind2: "inhale" | "exhale",
  beats: number,
  channel1: BreathChannel,
  channel2: BreathChannel,
): BreathPhaseShape {
  return {
    phases: [
      { kind: kind1, beats, channel: channel1 },
      { kind: kind2, beats, channel: channel2 },
    ],
    baseIndex: 0,
  };
}

export const BREATH_PRACTICES: BreathPracticeDescriptor[] = [
  {
    id: "coherent",
    indicatorKind: "bar",
    channelMode: "both",
    buildShape: (n) => equalPair("inhale", "exhale", n, "both", "both"),
    // Когерентное дыхание: 6 ударов пульса в вдох/выдох — это стандарт
    // Coherence 6bpm ≈ 0.1 Hz, резонансная частота парасимпатической
    // вариабельности HRV для большинства взрослых.
    normalBaseBeats: 6,
    minBaseBeats: 1,
    maxBaseBeats: 10,
  },
  {
    id: "nadi-shodhana",
    indicatorKind: "dual-bar",
    channelMode: "alternating",
    // Полный цикл попеременного дыхания: L-in, R-ex, R-in, L-ex.
    // 6 ударов по каждой стороне — тот же резонансный темп, что и у
    // coherent (канальное — подвид когерентного по динамике).
    buildShape: (n) => ({
      phases: [
        { kind: "inhale", beats: n, channel: "left" },
        { kind: "exhale", beats: n, channel: "right" },
        { kind: "inhale", beats: n, channel: "right" },
        { kind: "exhale", beats: n, channel: "left" },
      ],
      baseIndex: 0,
    }),
    normalBaseBeats: 6,
    minBaseBeats: 1,
    maxBaseBeats: 10,
  },
  {
    id: "surya-bhedana",
    indicatorKind: "dual-bar",
    channelMode: "right",
    buildShape: (n) => equalPair("inhale", "exhale", n, "right", "right"),
    normalBaseBeats: 6,
    minBaseBeats: 1,
    maxBaseBeats: 10,
  },
  {
    id: "chandra-bhedana",
    indicatorKind: "dual-bar",
    channelMode: "left",
    buildShape: (n) => equalPair("inhale", "exhale", n, "left", "left"),
    normalBaseBeats: 6,
    minBaseBeats: 1,
    maxBaseBeats: 10,
  },
  {
    id: "square",
    indicatorKind: "square",
    channelMode: "both",
    // Чатуранга пранаяма: вдох → задержка → выдох → задержка.
    // 4 удара на сторону — классический стандарт сама-вритти (1:1:1:1 @ 4),
    // удобно удерживать без напряжения. 4*4 = 16 ударов на цикл ≈ 16 с при
    // 60 bpm — комфортный ритм.
    buildShape: (n) => ({
      phases: [
        { kind: "inhale", beats: n, channel: "both" },
        { kind: "hold", beats: n, channel: "both" },
        { kind: "exhale", beats: n, channel: "both" },
        { kind: "hold", beats: n, channel: "both" },
      ],
      baseIndex: 0,
    }),
    normalBaseBeats: 4,
    minBaseBeats: 1,
    maxBaseBeats: 10,
  },
  {
    id: "triangle-up",
    indicatorKind: "triangle-up",
    channelMode: "both",
    // Висама-Вритти · Бахир Кумбхака: вдох → выдох → задержка после выдоха.
    // 5 ударов на сторону — средний темп: 3 фазы × 5 = 15 ударов ≈ 15 с
    // при 60 bpm. Быстрее, чем квадрат 4 (16 с), медленнее когерентного 6
    // (12 с на цикл).
    buildShape: (n) => ({
      phases: [
        { kind: "inhale", beats: n, channel: "both" },
        { kind: "exhale", beats: n, channel: "both" },
        { kind: "hold", beats: n, channel: "both" },
      ],
      baseIndex: 0,
    }),
    normalBaseBeats: 5,
    minBaseBeats: 1,
    maxBaseBeats: 10,
  },
  {
    id: "triangle-down",
    indicatorKind: "triangle-down",
    channelMode: "both",
    // Висама-Вритти · Антар Кумбхака: вдох → задержка после вдоха → выдох.
    buildShape: (n) => ({
      phases: [
        { kind: "inhale", beats: n, channel: "both" },
        { kind: "hold", beats: n, channel: "both" },
        { kind: "exhale", beats: n, channel: "both" },
      ],
      baseIndex: 0,
    }),
    normalBaseBeats: 5,
    minBaseBeats: 1,
    maxBaseBeats: 10,
  },
];

export function getBreathPracticeById(id: BreathPracticeId): BreathPracticeDescriptor {
  const found = BREATH_PRACTICES.find((p) => p.id === id);
  if (!found) {
    throw new Error(`Unknown breath practice id: ${id}`);
  }
  return found;
}
