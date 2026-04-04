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
