import { BleManager, type BleManagerOptions, LogLevel } from "@sfourdrinier/react-native-ble-plx";

let sharedManager: BleManager | null = null;

export function getWearableBleManager(): BleManager {
  if (sharedManager) return sharedManager;
  const options: BleManagerOptions = {
    restoreStateIdentifier: "harmonizer.ble.restore",
  };
  sharedManager = new BleManager(options);
  void sharedManager.setLogLevel(__DEV__ ? LogLevel.Warning : LogLevel.Error);
  return sharedManager;
}
