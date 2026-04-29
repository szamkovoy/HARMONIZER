/**
 * Базовый URL развёрнутого API с маршрутом `POST /api/communicator`
 * (например Next.js из `_legacy_web` на Vercel).
 */
export function getCommunicatorApiBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_COMMUNICATOR_API_URL?.trim();
  if (!raw) {
    throw new Error(
      "Задайте EXPO_PUBLIC_COMMUNICATOR_API_URL (origin без /api/communicator), например https://your-app.vercel.app",
    );
  }
  return raw.replace(/\/$/, "");
}

export function getCommunicatorApiUrl(): string {
  return `${getCommunicatorApiBaseUrl()}/api/communicator`;
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

export function getDailyForecastUrl(): string {
  return `${getCommunicatorApiBaseUrl()}/api/astro/daily-forecast`;
}
