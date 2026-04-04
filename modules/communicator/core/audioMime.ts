import { Platform } from "react-native";

/** MIME для inlineData Gemini по URI записи expo-av (см. `_legacy_web` — webm/mp4). */
export function mimeFromRecordingUri(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  if (lower.endsWith(".caf")) return "audio/mp4";
  if (lower.endsWith(".3gp")) return "audio/3gpp";
  return Platform.OS === "ios" ? "audio/mp4" : "audio/mp4";
}
