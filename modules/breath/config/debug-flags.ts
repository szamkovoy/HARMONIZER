import { HARMONIZER_TEST_MODE } from "@/modules/ui/testMode";

/**
 * Централизованные флаги «тестового режима» модуля BREATH.
 *
 * Мастер-флаг совпадает с продуктовым `HARMONIZER_TEST_MODE`
 * (`EXPO_PUBLIC_HARMONIZER_TEST_MODE`). В release с `false` сэмплинг,
 * JSON-экспорты и диагностические кнопки/футеры уходят из UI.
 *
 * Импортируют:
 *   - `modules/breath/debug/session-runtime-diagnostics.ts`
 *   - `modules/breath/debug/jank-detector.ts`
 *   - `modules/breath/ui/CoherenceBreathScreen.tsx`
 */

/**
 * Мастер-переключатель «всё диагностическое» = `HARMONIZER_TEST_MODE`.
 */
export const BREATH_TESTING_MODE = HARMONIZER_TEST_MODE;

/**
 * Записываем ли per-frame/per-second телеметрию (FPS, JS-лаг, heap, thermal
 * и т. д.). В продакшене — всегда `false`, на разработке совпадает с
 * `BREATH_TESTING_MODE`.
 *
 * Для **целевой совместимости**: тонкий тумблер. Если однажды понадобится
 * оставить лёгкие экспорты JSON в UI (для приёма feedback от пользователей),
 * но отключить тяжёлый сэмплинг — достаточно выставить здесь `false`,
 * не трогая остальные флаги.
 */
export const PERF_DIAGNOSTICS_ENABLED = BREATH_TESTING_MODE;

/**
 * Показывать ли в UI:
 *   - кнопку «Экспорт JSON (отладка)» на экране результатов;
 *   - кнопку «Отправить диагностику активации» в диалоге неудачного QC;
 *   - отладочные пояснения под таблицей результатов (schema, debugTimeBase,
 *     счётчик ударов в окне и после дедупликации).
 *
 * Всё это нужно в beta/qa, чтобы пользователи могли прислать `.json` с
 * поля («как прошла активация пульсометра» и «что пришло после замеров»).
 * В прод-сборке — `false`.
 */
export const DEBUG_ACTIVATION_EXPORT_ENABLED = BREATH_TESTING_MODE;

/**
 * Показывать ли pie-chart / таблицу «в начале / в конце», которая зависит
 * от hybrid windows. Сейчас всегда включена (нужна пользователю), но на
 * случай, если в будущем появится упрощённое представление — флаг под рукой.
 */
export const SHOW_HYBRID_RESULTS_TABLE = true;

/**
 * Дебаг-кнопки переключателя чакры на idle-экране. Оставляем даже в prod —
 * это часть пользовательского сценария (выбор практики = выбор чакры).
 * Но сам чакра-селектор тогда берётся из входных props модуля, а не из
 * локального UI. Пока UI для выбора чакры на экране нет — меняется только
 * через проп при навигации.
 */
export const SHOW_PRACTICE_PICKER_ON_IDLE = true;
