/**
 * Вход через Apple ID.
 *
 * Поток:
 *   1. Генерируем случайный rawNonce (32 байта → hex).
 *   2. Считаем SHA-256 от него — hashedNonce; именно его отдаём Apple.
 *   3. Apple возвращает identityToken (JWT), внутри которого claim `nonce` =
 *      hashedNonce.
 *   4. Отдаём Supabase identityToken + оригинальный rawNonce. Supabase на своей
 *      стороне хеширует nonce и сверяет с claim — это защищает от replay-атак.
 *
 * Apple возвращает имя/email только при ПЕРВОМ входе. Supabase сам это
 * учитывает и сохраняет в user_metadata. Дальше имя берём из profile.
 *
 * На симуляторе Apple Sign-In не работает до iOS 13.3+; на Android/web его нет
 * вовсе — проверяем `isAvailableAsync()` и выбрасываем осмысленную ошибку.
 */
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
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
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;
}
