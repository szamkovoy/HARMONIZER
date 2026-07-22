const {
  withAndroidManifest,
  withEntitlementsPlist,
  withInfoPlist,
  withMainActivity,
} = require("expo/config-plugins");

const HEALTH_PERMISSIONS = [
  "android.permission.health.READ_STEPS",
  "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
  "android.permission.health.READ_EXERCISE",
  "android.permission.health.READ_SLEEP",
];

function ensureUsesPermission(androidManifest, permissionName) {
  if (!androidManifest.manifest["uses-permission"]) {
    androidManifest.manifest["uses-permission"] = [];
  }
  const permissions = androidManifest.manifest["uses-permission"];
  const exists = permissions.some((item) => item?.$?.["android:name"] === permissionName);
  if (!exists) {
    permissions.push({ $: { "android:name": permissionName } });
  }
}

function addHealthConnectMainActivityDelegate(src) {
  let next = src;
  if (!next.includes("import android.os.Bundle")) {
    next = next.replace(/package [^\n]+\n/, (match) => `${match}\nimport android.os.Bundle\n`);
  }
  if (!next.includes("import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate")) {
    next = next.replace(
      /import android\.os\.Bundle\n/,
      "import android.os.Bundle\nimport dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate\n",
    );
  }
  if (next.includes("HealthConnectPermissionDelegate.setPermissionDelegate(this)")) {
    return next;
  }
  // Expo 54 MainActivity often calls `super.onCreate(null)` after splash theme —
  // match any super.onCreate(...), not only savedInstanceState.
  if (/super\.onCreate\([^)]*\)/.test(next)) {
    return next.replace(
      /super\.onCreate\([^)]*\)/,
      (match) => `${match}\n    HealthConnectPermissionDelegate.setPermissionDelegate(this)`,
    );
  }
  return next.replace(
    /class MainActivity : ReactActivity\(\) \{\n/,
    "class MainActivity : ReactActivity() {\n  override fun onCreate(savedInstanceState: Bundle?) {\n    super.onCreate(savedInstanceState)\n    HealthConnectPermissionDelegate.setPermissionDelegate(this)\n  }\n\n",
  );
}

function withNativeHealth(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NSHealthShareUsageDescription =
      cfg.modResults.NSHealthShareUsageDescription ??
      "Harmonizer читает шаги, тренировки, активные калории и сон, чтобы дать мягкую обратную связь при подытоживании дня.";
    cfg.modResults.NSHealthUpdateUsageDescription =
      cfg.modResults.NSHealthUpdateUsageDescription ??
      "Harmonizer не записывает данные здоровья, но iOS требует это описание для HealthKit capability.";
    return cfg;
  });

  config = withEntitlementsPlist(config, (cfg) => {
    cfg.modResults["com.apple.developer.healthkit"] = true;
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    for (const permission of HEALTH_PERMISSIONS) {
      ensureUsesPermission(cfg.modResults, permission);
    }
    return cfg;
  });

  config = withMainActivity(config, (cfg) => {
    if (cfg.modResults.language === "kt") {
      cfg.modResults.contents = addHealthConnectMainActivityDelegate(cfg.modResults.contents);
    }
    return cfg;
  });

  return config;
}

module.exports = withNativeHealth;
