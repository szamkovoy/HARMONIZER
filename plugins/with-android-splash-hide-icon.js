/**
 * Android 12+ SplashScreen API only allows a centered icon (≤288dp) — never a
 * true full-bleed image (unlike iOS `enableFullScreenImage_legacy`). Showing
 * that icon causes a small→large jump when JS `EarlySplashCover` takes over.
 *
 * Strategy (Pixel QA 2026-08-02):
 * 1) Transparent `windowSplashScreenAnimatedIcon` — no mini lotus.
 * 2) Full-bleed `splash.png` as `android:windowBackground` on Splash + AppTheme
 *    so after the system splash exits the large art is already on screen.
 * 3) Hide the system SplashScreen from MainActivity.onCreate immediately —
 *    do not wait for JS. That avoids the solid-white hang (transparent icon +
 *    white splash bg while Hermes boots).
 *
 * Must use `withFinalizedMod` after `expo-splash-screen` writes styles/images.
 */
const { withFinalizedMod, withMainActivity } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const TRANSPARENT_DRAWABLE = "splashscreen_transparent";
/** Bitmap in drawable-nodpi (resource name without extension). */
const FULLBLEED_BITMAP = "splashscreen_fullbleed_bitmap";
const FULLBLEED_BITMAP_FILE = `${FULLBLEED_BITMAP}.png`;
/** Layer-list used as windowBackground. */
const FULLBLEED_DRAWABLE = "splashscreen_fullbleed";
const SOURCE_SPLASH = path.join("assets", "images", "splash.png");

const STYLES_REL = path.join(
  "android",
  "app",
  "src",
  "main",
  "res",
  "values",
  "styles.xml",
);
const DRAWABLE_DIR = path.join("android", "app", "src", "main", "res", "drawable");
const DRAWABLE_NODPI_DIR = path.join(
  "android",
  "app",
  "src",
  "main",
  "res",
  "drawable-nodpi",
);

const TRANSPARENT_DRAWABLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@android:color/transparent" />
</shape>
`;

const FULLBLEED_LAYER_XML = `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/splashscreen_background" />
    <item>
        <bitmap
            android:gravity="fill"
            android:src="@drawable/${FULLBLEED_BITMAP}" />
    </item>
</layer-list>
`;

function ensureFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function ensureFullbleedAssets(projectRoot) {
  const src = path.join(projectRoot, SOURCE_SPLASH);
  if (!fs.existsSync(src)) {
    console.warn(
      `[with-android-splash-hide-icon] missing ${SOURCE_SPLASH} — skip full-bleed`,
    );
    return false;
  }
  const nodpiDir = path.join(projectRoot, DRAWABLE_NODPI_DIR);
  fs.mkdirSync(nodpiDir, { recursive: true });
  fs.copyFileSync(src, path.join(nodpiDir, FULLBLEED_BITMAP_FILE));
  ensureFile(
    path.join(projectRoot, DRAWABLE_DIR, `${TRANSPARENT_DRAWABLE}.xml`),
    TRANSPARENT_DRAWABLE_XML,
  );
  ensureFile(
    path.join(projectRoot, DRAWABLE_DIR, `${FULLBLEED_DRAWABLE}.xml`),
    FULLBLEED_LAYER_XML,
  );
  return true;
}

function upsertStyleItem(styleBlock, name, value) {
  const itemRe = new RegExp(
    `<item name="${name.replace(/:/g, ":")}">[^<]*</item>`,
  );
  const item = `<item name="${name}">${value}</item>`;
  if (itemRe.test(styleBlock)) {
    return styleBlock.replace(itemRe, item);
  }
  return styleBlock.replace(
    /(\n\s*)(<\/style>)/,
    `$1    ${item}$1$2`,
  );
}

function patchStylesXml(projectRoot) {
  const stylesPath = path.join(projectRoot, STYLES_REL);
  if (!fs.existsSync(stylesPath)) {
    console.warn(
      "[with-android-splash-hide-icon] styles.xml missing — skip",
    );
    return;
  }

  let xml = fs.readFileSync(stylesPath, "utf8");

  // Theme.App.SplashScreen — hide mini icon + full-bleed window background.
  xml = xml.replace(
    /(<style name="Theme\.App\.SplashScreen"[^>]*>)([\s\S]*?)(<\/style>)/,
    (_m, open, body, close) => {
      let next = body;
      next = next.replace(
        /(<item name="windowSplashScreenAnimatedIcon">)[^<]*(<\/item>)/,
        `$1@drawable/${TRANSPARENT_DRAWABLE}$2`,
      );
      next = next.replace(
        /\n\s*<item name="android:windowSplashScreenBehavior">[^<]*<\/item>/g,
        "",
      );
      next = upsertStyleItem(
        next,
        "android:windowBackground",
        `@drawable/${FULLBLEED_DRAWABLE}`,
      );
      return `${open}${next}${close}`;
    },
  );

  // AppTheme — after postSplashScreenTheme switch, keep large splash until JS paints.
  xml = xml.replace(
    /(<style name="AppTheme"[^>]*>)([\s\S]*?)(<\/style>)/,
    (_m, open, body, close) => {
      const next = upsertStyleItem(
        body,
        "android:windowBackground",
        `@drawable/${FULLBLEED_DRAWABLE}`,
      );
      return `${open}${next}${close}`;
    },
  );

  fs.writeFileSync(stylesPath, xml);
}

function withImmediateNativeSplashHide(config) {
  return withMainActivity(config, (cfg) => {
    const lang = cfg.modResults.language;
    let contents = cfg.modResults.contents;
    const hideLine =
      lang === "java"
        ? "    SplashScreenManager.hide();"
        : "    SplashScreenManager.hide()";
    const registerRe =
      /SplashScreenManager\.registerOnActivity\(this\)(;)?/;
    if (!registerRe.test(contents)) {
      console.warn(
        "[with-android-splash-hide-icon] registerOnActivity not found — skip immediate hide",
      );
      return cfg;
    }
    if (contents.includes("SplashScreenManager.hide()")) {
      return cfg;
    }
    contents = contents.replace(
      registerRe,
      (match) => `${match}\n${hideLine}`,
    );
    cfg.modResults.contents = contents;
    return cfg;
  });
}

function withAndroidSplashHideIcon(config) {
  config = withImmediateNativeSplashHide(config);
  return withFinalizedMod(config, [
    "android",
    async (cfg) => {
      const root = cfg.modRequest.projectRoot;
      if (ensureFullbleedAssets(root)) {
        patchStylesXml(root);
      }
      return cfg;
    },
  ]);
}

module.exports = withAndroidSplashHideIcon;
