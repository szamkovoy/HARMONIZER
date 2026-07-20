/**
 * Единый клиентский бюджет ожидания для путей, где день может ждать LLM
 * (смена языка, онбординг-прогрев, forceRefresh morning/forecast).
 *
 * Обычный cold paint Home (кэш / structural) остаётся на коротком таймауте
 * в `dailyForecastClient` / `globalContentClient` (25s) — сюда не смешиваем.
 */
export const DAY_CONTENT_LLM_TIMEOUT_MS = 120_000;
