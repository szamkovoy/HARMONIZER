/**
 * Client-side OTP send cooldown (UX only). Server rate limits are authoritative.
 */
import * as SecureStore from "expo-secure-store";

const KEY = "harmonizer.otp.sendCooldownUntil";

export async function readOtpCooldownRemainingSec(): Promise<number> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return 0;
    const until = Number(raw);
    if (!Number.isFinite(until)) return 0;
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  } catch {
    return 0;
  }
}

export async function markOtpCooldown(seconds = 60): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, String(Date.now() + seconds * 1000));
  } catch {
    // ignore — server still enforces
  }
}

export async function clearOtpCooldown(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // ignore
  }
}
