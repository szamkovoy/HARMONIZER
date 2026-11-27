/**
 * Play treats any android:screenOrientation="portrait" as an implicit
 * requirement for android.hardware.screen.portrait and then hides the app
 * from devices that do not report that feature (some phones, tablets,
 * desktop, Android XR).
 *
 * MainActivity is locked by expo.orientation. ML Kit's barcode activity
 * (pulled in by react-native-vision-camera) is portrait too. Declaring the
 * feature optional does not unlock landscape on phones.
 *
 * tools:replace wins if a library manifest merges android:required="true"
 * (uses-feature required is OR-merged; true would otherwise stick).
 */
const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

const PORTRAIT_FEATURE = "android.hardware.screen.portrait";

function ensureOptionalPortraitFeature(androidManifest) {
  AndroidConfig.Manifest.ensureToolsAvailable(androidManifest);
  const manifest = androidManifest.manifest;
  if (!Array.isArray(manifest["uses-feature"])) {
    manifest["uses-feature"] = [];
  }
  const features = manifest["uses-feature"];
  const existing = features.find((item) => item?.$?.["android:name"] === PORTRAIT_FEATURE);
  const attrs = {
    "android:name": PORTRAIT_FEATURE,
    "android:required": "false",
    "tools:replace": "android:required",
  };
  if (existing) {
    existing.$ = { ...existing.$, ...attrs };
  } else {
    features.push({ $: attrs });
  }
  return androidManifest;
}

function withAndroidOptionalScreenPortrait(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = ensureOptionalPortraitFeature(cfg.modResults);
    return cfg;
  });
}

module.exports = withAndroidOptionalScreenPortrait;
module.exports.ensureOptionalPortraitFeature = ensureOptionalPortraitFeature;
