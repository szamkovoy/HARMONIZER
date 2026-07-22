/**
 * Android 12+ requires runtime BLUETOOTH_SCAN / CONNECT before BLE scan/connect.
 * Without this, Polar/Magene discovery often returns empty with no clear error.
 */
import { PermissionsAndroid, Platform } from "react-native";

export async function ensureAndroidBlePermissions(): Promise<{
  granted: boolean;
  denied: string[];
}> {
  if (Platform.OS !== "android") {
    return { granted: true, denied: [] };
  }

  const apiLevel =
    typeof Platform.Version === "number" ? Platform.Version : Number.parseInt(String(Platform.Version), 10);

  if (!Number.isFinite(apiLevel) || apiLevel < 31) {
    // Pre-12: BLE often piggybacks on location; ble-plx / OS handle legacy path.
    return { granted: true, denied: [] };
  }

  const needed = [
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  ];
  const result = await PermissionsAndroid.requestMultiple(needed);
  const denied = needed.filter((permission) => result[permission] !== PermissionsAndroid.RESULTS.GRANTED);
  return { granted: denied.length === 0, denied };
}
