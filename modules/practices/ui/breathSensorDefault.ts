import type { BreathSensorMode } from "@/modules/practices/core/types";

/**
 * When a remembered BLE strap is confirmed missing, demote UI/prefs from `ble`
 * to `none`. Never overwrite an intentional `fingerCamera` / `none` choice —
 * late probe results used to stomp "пульс с телефона" after the user picked it.
 */
export function shouldDemoteUnavailableBleToNone(input: {
  preferredSensorMode: BreathSensorMode;
  selectedSensorMode: BreathSensorMode;
  hasRememberedWearable: boolean;
  probing: boolean;
  available: boolean | null;
  liveLinkReady: boolean;
}): boolean {
  if (!input.hasRememberedWearable) return false;
  if (input.probing) return false;
  if (input.available !== false) return false;
  if (input.liveLinkReady) return false;
  return input.preferredSensorMode === "ble" || input.selectedSensorMode === "ble";
}
