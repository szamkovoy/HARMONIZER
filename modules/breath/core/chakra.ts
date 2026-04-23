/**
 * Чакра как один из входных параметров модуля BREATH.
 *
 * Назначение: внешний код, запускающий практику, сообщает, «на какую чакру
 * направлена практика». Модуль BREATH использует эту информацию, чтобы
 * выбрать цветовой профиль мандалы (7 пресетов уже реализованы в
 * `modules/mandala/experiments/binduSuccessionVisualPresets`).
 *
 * ВАЖНО: тип «чакра» живёт тут (в breath), а НЕ в mandala, потому что:
 *   - mandala ничего не знает про «чакры» как концепт — у неё просто 7
 *     пресетов, индексируемых 0..6;
 *   - BREATH — это точка, где решается, какая практика и, следовательно,
 *     какая чакра активна.
 *
 * Конвенция нумерации (1..7) — «обычная йоговская», от корневой к коронной.
 * Для `DEFAULT_BINDU_SUCCESSION_VISUAL_PRESETS` (0-indexed) делаем явный
 * сдвиг в `toChakraPresetIndex()`.
 */

/** Идентификатор чакры 1..7 (1 = муладхара, 7 = сахасрара). */
export type Chakra = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** По умолчанию — третья чакра (соответствует текущему тестированию). */
export const DEFAULT_CHAKRA: Chakra = 3;

/** Проверка: произвольное число — валидный `Chakra`? */
export function isChakra(value: unknown): value is Chakra {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 7
  );
}

/**
 * Преобразование человеческого номера чакры (1..7) в индекс пресета мандалы
 * (0..6). Отрицательные/выходящие за диапазон значения безопасно
 * клампятся, чтобы мандала гарантированно что-то отрисовала.
 */
export function toChakraPresetIndex(chakra: Chakra): number {
  const idx = Math.max(1, Math.min(7, chakra));
  return idx - 1;
}

/**
 * Человекочитаемые имена чакр — для логов/экспортов. UI НЕ использует этот
 * словарь (локализацию добавим позже, если понадобится).
 */
export const CHAKRA_CANONICAL_NAMES: Record<Chakra, string> = {
  1: "Muladhara (root)",
  2: "Svadhisthana (sacral)",
  3: "Manipura (solar plexus)",
  4: "Anahata (heart)",
  5: "Vishuddha (throat)",
  6: "Ajna (third eye)",
  7: "Sahasrara (crown)",
};
