/**
 * Android 12+ SplashScreen API only shows a centered icon (≤288dp) — never a
 * full-bleed image. That causes a visible small→large jump when JS
 * `EarlySplashCover` takes over with the real splash art.
 *
 * Must use `withFinalizedMod` (after all other mods write files):
 * - `withDangerousMod` runs *before* other mods
 * - `withAndroidStyles` from a late plugin runs *before* `expo-splash-screen`
 *   style mods (LIFO), so the theme may not exist yet
 *
 * Replaces `windowSplashScreenAnimatedIcon` with a transparent drawable and
 * drops `android:windowSplashScreenBehavior` so the OS splash is only the
 * background color until `SplashScreen.hideAsync()` reveals the JS cover.
 *
 * Pair with `EarlySplashCover` that calls hide only after `Image.onLoadEnd`
 * (hiding earlier → blank white death screen).
 */
const { withFinalizedMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const TRANSPARENT_DRAWABLE = "splashscreen_transparent";
const STYLES_REL = path.join(
  "android",
  "app",
  "src",
  "main",
  "res",
  "values",
  "styles.xml",
);
const DRAWABLE_REL = path.join(
  "android",
  "app",
  "src",
  "main",
  "res",
  "drawable",
  `${TRANSPARENT_DRAWABLE}.xml`,
);

const TRANSPARENT_DRAWABLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@android:color/transparent" />
</shape>
`;

function ensureTransparentDrawable(projectRoot) {
  const filePath = path.join(projectRoot, DRAWABLE_REL);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, TRANSPARENT_DRAWABLE_XML);
}

function patchStylesXml(projectRoot) {
  const stylesPath = path.join(projectRoot, STYLES_REL);
  if (!fs.existsSync(stylesPath)) {
    console.warn(
      "[with-android-splash-hide-icon] styles.xml missing — skip icon hide",
    );
    return;
  }

  let xml = fs.readFileSync(stylesPath, "utf8");
  const before = xml;

  xml = xml.replace(
    /(<item name="windowSplashScreenAnimatedIcon">)[^<]*(<\/item>)/,
    `$1@drawable/${TRANSPARENT_DRAWABLE}$2`,
  );

  xml = xml.replace(
    /\n\s*<item name="android:windowSplashScreenBehavior">[^<]*<\/item>/g,
    "",
  );

  if (xml === before) {
    console.warn(
      "[with-android-splash-hide-icon] Theme.App.SplashScreen icon item not found — skip",
    );
    return;
  }

  fs.writeFileSync(stylesPath, xml);
}

function withAndroidSplashHideIcon(config) {
  return withFinalizedMod(config, [
    "android",
    async (cfg) => {
      const root = cfg.modRequest.projectRoot;
      ensureTransparentDrawable(root);
      patchStylesXml(root);
      return cfg;
    },
  ]);
}

module.exports = withAndroidSplashHideIcon;
