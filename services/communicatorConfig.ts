/**
 * Базовый URL развёрнутого API с маршрутами новой архитектуры
 * (`/api/communicator/v2/*`, `/api/calibration/*`, `/api/astro/*`)
 * (например Next.js из `_legacy_web` на Vercel).
 */
export function getCommunicatorApiBaseUrl(): string {
  const raw = (
    process.env.EXPO_PUBLIC_COMMUNICATOR_API_URL ??
    process.env.EXPO_PUBLIC_BACKEND_API_URL ??
    ""
  ).trim();
  if (!raw) {
    throw new Error(
      "Задайте EXPO_PUBLIC_COMMUNICATOR_API_URL (origin без /api), например https://your-app.vercel.app",
    );
  }
  return raw
    .replace(/\/+$/, "")
    .replace(/\/api\/communicator\/v2\/?$/, "")
    .replace(/\/api\/communicator\/?$/, "")
    .replace(/\/api\/?$/, "");
}

export function getCommunicatorV2DialogUrl(): string {
  return `${getCommunicatorApiBaseUrl()}/api/communicator/v2/dialog`;
}

export function getCommunicatorV2TranscribeUrl(): string {
  return `${getCommunicatorApiBaseUrl()}/api/communicator/v2/transcribe`;
}

export function getCalibrationExtractUrl(): string {
  return `${getCommunicatorApiBaseUrl()}/api/calibration/extract`;
}

export function getAstroNatalUrl(): string {
  return `${getCommunicatorApiBaseUrl()}/api/astro/natal`;
}

/**
 * Дневной прогноз идёт через основной Vercel API. Supabase остаётся только
 * источником auth/JWT и данных; мобильный клиент не должен зависеть от
 * локального прокси или отдельного Supabase Edge URL без явной настройки.
 */
export function getDailyForecastUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_DAILY_FORECAST_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  return `${getCommunicatorApiBaseUrl()}/api/astro/daily-forecast`;
}

/** POST: принять/отклонить AI-предложение состояния (Bearer JWT). */
export function getAiProposalRespondUrl(proposalId: string): string {
  return `${getCommunicatorApiBaseUrl()}/api/proposals/${proposalId}/respond`;
}
