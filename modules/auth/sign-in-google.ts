/**
 * Вход через Google.
 *
 * `@react-native-google-signin/google-signin` — обёртка над нативным Google
 * Sign-In SDK. Возвращает `idToken`, который отдаём в Supabase для обмена на
 * сессию.
 *
 * Настройка:
 *   • `webClientId` — из Google Cloud Console (OAuth 2.0 Client ID типа
 *     "Web application"). Используется и в Supabase (раздел Providers) и тут
 *     — они должны совпадать.
 *   • `iosClientId` — OAuth 2.0 Client ID типа "iOS" для bundle id
 *     com.zamkovoi.harmonizer.app.
 *   • Android берёт конфигурацию автоматически из google-services.json /
 *     SHA-1 отпечатка подписи APK.
 *
 * Конфигурируем ЛЕНИВО — на первом вызове `signInWithGoogle`. Это чтобы не
 * падать, если env-переменных ещё нет (например, при dev-запуске без
 * Google Client ID).
 *
 * Nonce / Supabase:
 *   На iOS Google Sign-In SDK часто кладёт `nonce` в id_token, а публичный
 *   `@react-native-google-signin/google-signin` не даёт передать свой nonce в
 *   нативный запрос (в отличие от Apple). Тогда GoTrue требует «nonce в теле
 *   запроса и в id_token — оба или ни одного». Решение: в Supabase Dashboard →
 *   Authentication → Providers → Google включите «Skip nonce check».
 *   Мы передаём `access_token` из `getTokens()`, если он есть (нужно при at_hash).
 */
import {
  GoogleSignin,
  statusCodes,
  isErrorWithCode,
} from "@react-native-google-signin/google-signin";
import type { AuthError } from "@supabase/supabase-js";
import { requireSupabase } from "@/services/supabase";

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();

const SUPABASE_NONCE_MISMATCH =
  "Passed nonce and nonce in id_token should either both exist or not";

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const segment = jwt.split(".")[1];
    if (!segment) return null;
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (base64.length % 4)) % 4;
    const padded = base64 + "=".repeat(pad);
    const json = globalThis.atob(padded);
    const obj = JSON.parse(json) as unknown;
    return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isNoncePresenceMismatch(error: AuthError): boolean {
  return typeof error.message === "string" && error.message.includes(SUPABASE_NONCE_MISMATCH);
}

let configured = false;

function ensureConfigured() {
  if (configured) return;
  if (!WEB_CLIENT_ID) {
    throw new Error(
      "Google Sign-In не сконфигурирован: задайте EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID в .env.local.",
    );
  }
  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,
    iosClientId: IOS_CLIENT_ID,
    scopes: ["openid", "email", "profile"],
    offlineAccess: false,
  });
  configured = true;
}

export async function signInWithGoogle(): Promise<void> {
  ensureConfigured();

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  } catch (e) {
    if (isErrorWithCode(e) && e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new Error("На устройстве недоступны Google Play Services.");
    }
    throw e;
  }

  const response = await GoogleSignin.signIn();
  if (response.type !== "success") {
    // type 'cancelled' — пользователь закрыл окно; выбрасываем тихую отмену.
    throw new Error("Sign in cancelled");
  }

  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error("Google did not return an idToken (проверьте webClientId).");
  }

  const supabase = requireSupabase();

  let accessToken: string | undefined;
  try {
    const tokens = await GoogleSignin.getTokens();
    accessToken = tokens.accessToken;
  } catch {
    accessToken = undefined;
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
    ...(accessToken ? { access_token: accessToken } : {}),
  });

  if (error) {
    const payload = decodeJwtPayload(idToken);
    const tokenHasNonce =
      typeof payload?.nonce === "string" && (payload.nonce as string).length > 0;

    if (tokenHasNonce && isNoncePresenceMismatch(error)) {
      throw new Error(
        "Google Sign-In: в id_token есть nonce (часто на iOS), а передать парный " +
          "nonce в Supabase из этой версии @react-native-google-signin/google-signin нельзя. " +
          "В Supabase Dashboard → Authentication → Providers → Google включите «Skip nonce check». " +
          "Альтернатива — поток с явным nonce (Credential Manager / Universal Sign-In). " +
          `Исходная ошибка: ${error.message}`,
      );
    }
    throw error;
  }
}

export async function signOutGoogle(): Promise<void> {
  if (!configured) return;
  try {
    await GoogleSignin.signOut();
  } catch {
    // ignore
  }
}
