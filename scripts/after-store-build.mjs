#!/usr/bin/env node
/**
 * Post-step for local production EAS builds.
 * Reminds that autoIncrement already wrote ios.buildNumber / android.versionCode
 * into app.json — commit that file once; upload the artifact once.
 *
 * Usage (from package.json):
 *   node scripts/after-store-build.mjs android
 *   node scripts/after-store-build.mjs ios
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const platform = (process.argv[2] || "").trim().toLowerCase();
const appJsonPath = resolve(process.cwd(), "app.json");

let expo;
try {
  expo = JSON.parse(readFileSync(appJsonPath, "utf8")).expo;
} catch (error) {
  console.error("[after-store-build] Cannot read app.json:", error?.message || error);
  process.exit(1);
}

const marketing = expo?.version ?? "?";
const iosBuild = expo?.ios?.buildNumber ?? "?";
const androidCode = expo?.android?.versionCode ?? "?";
const artifact =
  platform === "ios"
    ? "dist/harmonizer-production.ipa"
    : platform === "android"
      ? "dist/harmonizer-production.aab"
      : "dist/harmonizer-production.*";

console.log("");
console.log("[after-store-build] Store version state in app.json (EAS autoIncrement already applied):");
console.log(`  marketing     ${marketing}`);
console.log(`  ios build     ${iosBuild}`);
console.log(`  android code  ${androidCode}`);
console.log(`  artifact      ${artifact}`);
console.log("");
console.log("Next (required to avoid Play/App Store versionCode collisions):");
console.log("  1. Commit app.json if versionCode / buildNumber changed.");
console.log("  2. Upload this artifact ONCE (Play / TestFlight). Do not re-upload the same file.");
console.log("  3. Do NOT hand-edit versionCode / buildNumber before the next prod build —");
console.log("     production/preview profiles use eas.json autoIncrement.");
console.log("  See DEPLOY.md → «App version (marketing + build)».");
console.log("");
