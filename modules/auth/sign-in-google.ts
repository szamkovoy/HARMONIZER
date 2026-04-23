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
 *     com.zamkovoi.harmonizer.
 *   • Android берёт конфигурацию автоматически из google-services.json /
 *     SHA-1 отпечатка подписи APK.
 *
 * Конфигурируем ЛЕНИВО — на первом вызове `signInWithGoogle`. Это чтобы не
 * падать, если env-переменных ещё нет (например, при dev-запуске без
 * Google Client ID).
 */
import {
  GoogleSignin,
  statusCodes,
  isErrorWithCode,
} from "@react-native-google-signin/google-signin";
import { requireSupabase } from "@/services/supabase";

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();

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
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });
  if (error) throw error;
}

export async function signOutGoogle(): Promise<void> {
  if (!configured) return;
  try {
    await GoogleSignin.signOut();
  } catch {
    // ignore
  }
}
