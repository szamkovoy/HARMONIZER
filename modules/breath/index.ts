/**
 * Публичный API модуля BREATH.
 *
 * Этот файл — ЕДИНСТВЕННАЯ точка входа для внешнего кода. Всё остальное
 * (core-алгоритмы, UI-компоненты, диагностика) — деталь реализации и из-
 * вне импортироваться не должно. См. `modules/breath/README.md`.
 *
 * Контракт входа (`BreathPracticeInput`):
 *   - `practiceId` — какую практику запускать (когерентное / канальное /
 *     квадрат / треугольники);
 *   - `durationMs`  — длительность практики;
 *   - `chakra`      — на какую чакру направлена практика (1..7); от этого
 *     зависит цветовой профиль мандалы.
 *
 * Контракт выхода (`BreathPracticeOutcome`):
 *   - структурированный JSON с метриками «в начале / в конце» и сводкой
 *     по всей практике. Точный формат — см. `BreathPracticeOutcome` ниже.
 *
 * См. также: `@/modules/breath/config/debug-flags` — флаги тестового
 * режима и отладки.
 */

export { CoherenceBreathScreen } from "@/modules/breath/ui/CoherenceBreathScreen";
export type { BreathPracticeInput, BreathPracticeOutcome } from "@/modules/breath/core/practice-io";
export { DEFAULT_CHAKRA, isChakra, toChakraPresetIndex } from "@/modules/breath/core/chakra";
export type { Chakra } from "@/modules/breath/core/chakra";
export type { BreathPracticeId, BreathLocale } from "@/modules/breath/i18n/coherence";
export { BREATH_PRACTICES, getBreathPracticeById } from "@/modules/breath/core/practices";
export type { BreathPracticeDescriptor } from "@/modules/breath/core/practices";
export {
  buildShapeForTempo,
  cardTempoOptionKeys,
  defaultTempoKey,
  formatTempoLabel,
  resolveTempoKey,
} from "@/modules/breath/core/breath-tempo";
