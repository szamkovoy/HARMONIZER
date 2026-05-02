/**
 * Нативный вход через Apple (iOS) — `expo-apple-authentication` + Supabase
 * `auth.signInWithIdToken({ provider: "apple", ... })`.
 *
 * Намеренно НЕ используем `signInWithOAuth` для Apple: нативный identity token
 * не требует Client Secret (JWT), который при веб-OAuth у Apple нужно обновлять
 * каждые ~6 месяцев.
 *
 * Поток:
 *   1. Генерируем случайный rawNonce (32 байта → hex).
 *   2. Считаем SHA-256 от него — hashedNonce; в `signInAsync` передаём именно
 *      hashed nonce (требование Apple).
 *   3. Apple возвращает `identityToken` (JWT). В payload `aud` = Bundle ID
 *      приложения — он должен совпадать с `ios.bundleIdentifier` в app.json
 *      (`com.zamkovoi.harmonizer.app`) и с App ID в Apple Developer / настройками
 *      Apple в Supabase для нативного входа.
 *   4. В Supabase передаём `token: identityToken` и `nonce: rawNonce`; сервер
 *      хеширует nonce и сверяет с claim в JWT.
 *
 * Имя/email Apple отдаёт только при первом входе — дальше Supabase хранит
 * метаданные пользователя.
 *
 * Доступность: `isAvailableAsync()` (симулятор с ограничениями; Android — нет).
 */
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { rewriteAuthNetworkError } from "./authNetworkErrors";
import { requireSupabase } from "@/services/supabase";

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function signInWithApple(): Promise<void> {
  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) {
    throw new Error("Sign in with Apple is not available on this device.");
  }

  const rawNonceBytes = await Crypto.getRandomBytesAsync(32);
  const rawNonce = bytesToHex(rawNonceBytes);
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });

  if (!credential.identityToken) {
    throw new Error("Apple did not return an identity token.");
  }

  const supabase = requireSupabase();
  try {
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: credential.identityToken,
      nonce: rawNonce,
    });
    if (error) throw error;
  } catch (error) {
    throw rewriteAuthNetworkError(error, "sign_in");
  }
}
