/**
 * Normalizes Android permission declarations so Google Play does not reject the
 * AAB for "same permission declared with different maxSdkVersion".
 *
 * Conflicts we hit / prevent:
 * 1) Location — BLE `neverForLocation` injects
 *    `<uses-permission-sdk-23 … maxSdkVersion="30"/>` while `expo-location`
 *    needs unrestricted GPS → keep one unrestricted `uses-permission` + remove sdk-23.
 * 2) Legacy Bluetooth — library uses `maxSdkVersion="30"`; Expo `android.permissions`
 *    may re-add without cap → force `maxSdkVersion="30"` (API 31+ uses SCAN/CONNECT).
 * 3) External storage — some Expo modules set `maxSdkVersion="32"`, others do not
 *    → force `maxSdkVersion="32"`.
 *
 * Must run AFTER `@sfourdrinier/react-native-ble-plx` in `app.config.ts`.
 */
const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

const LOCATION_PERMISSIONS = [
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
];

const LEGACY_BLUETOOTH_PERMISSIONS = [
  "android.permission.BLUETOOTH",
  "android.permission.BLUETOOTH_ADMIN",
];

const STORAGE_PERMISSIONS = [
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
];

const BLUETOOTH_SCAN = "android.permission.BLUETOOTH_SCAN";

function ensureUsesPermissionList(androidManifest) {
  if (!Array.isArray(androidManifest.manifest["uses-permission"])) {
    androidManifest.manifest["uses-permission"] = [];
  }
  return androidManifest.manifest["uses-permission"];
}

function removePermissionsByName(list, names) {
  const nameSet = new Set(names);
  return list.filter((item) => !nameSet.has(item?.$?.["android:name"]));
}

function pushPermission(list, attrs) {
  list.push({ $: attrs });
}

function normalizeStorePermissions(androidManifest) {
  AndroidConfig.Manifest.ensureToolsAvailable(androidManifest);

  // —— Location: drop BLE sdk-23 capped entries; keep unrestricted (GPS needed) ——
  const sdk23 = Array.isArray(androidManifest.manifest["uses-permission-sdk-23"])
    ? androidManifest.manifest["uses-permission-sdk-23"]
    : [];
  androidManifest.manifest["uses-permission-sdk-23"] = removePermissionsByName(
    sdk23,
    LOCATION_PERMISSIONS,
  );
  for (const name of LOCATION_PERMISSIONS) {
    pushPermission(androidManifest.manifest["uses-permission-sdk-23"], {
      "android:name": name,
      "tools:node": "remove",
    });
  }

  let permissions = ensureUsesPermissionList(androidManifest);
  permissions = removePermissionsByName(permissions, [
    ...LOCATION_PERMISSIONS,
    ...LEGACY_BLUETOOTH_PERMISSIONS,
    ...STORAGE_PERMISSIONS,
    BLUETOOTH_SCAN,
  ]);

  for (const name of LOCATION_PERMISSIONS) {
    pushPermission(permissions, {
      "android:name": name,
      "tools:node": "replace",
    });
  }

  // —— Legacy Bluetooth: only required through API 30 ——
  for (const name of LEGACY_BLUETOOTH_PERMISSIONS) {
    pushPermission(permissions, {
      "android:name": name,
      "android:maxSdkVersion": "30",
      "tools:node": "replace",
    });
  }

  // —— BLE scan is not used for location (Play / Android 12+) ——
  // Expo `android.permissions` can register BLUETOOTH_SCAN before the BLE plugin
  // runs; without neverForLocation the flag is skipped. Force it here.
  pushPermission(permissions, {
    "android:name": BLUETOOTH_SCAN,
    "android:usesPermissionFlags": "neverForLocation",
    "tools:targetApi": "31",
    "tools:node": "replace",
  });

  // —— Storage: MediaStore era — only through API 32 ——
  for (const name of STORAGE_PERMISSIONS) {
    pushPermission(permissions, {
      "android:name": name,
      "android:maxSdkVersion": "32",
      "tools:node": "replace",
    });
  }

  androidManifest.manifest["uses-permission"] = permissions;
  return androidManifest;
}

function withAndroidLocationPermissionMerge(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = normalizeStorePermissions(cfg.modResults);
    return cfg;
  });
}

module.exports = withAndroidLocationPermissionMerge;
module.exports.normalizeStorePermissions = normalizeStorePermissions;
