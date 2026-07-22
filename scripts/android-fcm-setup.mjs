#!/usr/bin/env node
/**
 * Validates Android FCM files for Harmonizer Expo push.
 *
 * Usage:
 *   node scripts/android-fcm-setup.mjs
 *
 * Expected files (after Firebase Console setup):
 *   ./google-services.json          — Android app config (package com.zamkovoi.harmonizer)
 *   ./fcm-service-account.json      — FCM V1 private key (gitignored; upload to EAS)
 *
 * Then:
 *   eas credentials -p android
 *   → Google Service Account → FCM V1 → Upload fcm-service-account.json
 *   npx expo run:android   (or eas build --profile development -p android)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedPackage = "com.zamkovoi.harmonizer";
const googleServicesPath = path.join(root, "google-services.json");
const serviceAccountPath = path.join(root, "fcm-service-account.json");

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`✓ ${message}`);
}

console.log("Android FCM setup check (Harmonizer)\n");

if (!fs.existsSync(googleServicesPath)) {
  fail(
    `Missing ${path.relative(root, googleServicesPath)}\n` +
      "  1) https://console.firebase.google.com → create/open project\n" +
      "  2) Add Android app with package name com.zamkovoi.harmonizer\n" +
      "  3) Download google-services.json into the repo root",
  );
} else {
  try {
    const raw = JSON.parse(fs.readFileSync(googleServicesPath, "utf8"));
    const clients = Array.isArray(raw.client) ? raw.client : [];
    const packages = clients
      .map((c) => c?.client_info?.android_client_info?.package_name)
      .filter(Boolean);
    if (!packages.includes(expectedPackage)) {
      fail(
        `google-services.json has no Android client for ${expectedPackage} ` +
          `(found: ${packages.join(", ") || "none"})`,
      );
    } else {
      ok(`google-services.json includes ${expectedPackage}`);
    }
    const projectId = raw.project_info?.project_id;
    if (projectId) ok(`Firebase project_id: ${projectId}`);
  } catch (error) {
    fail(`google-services.json is not valid JSON: ${error.message}`);
  }
}

if (!fs.existsSync(serviceAccountPath)) {
  fail(
    `Missing ${path.relative(root, serviceAccountPath)} (gitignored)\n` +
      "  Firebase Console → Project settings → Service accounts → Generate new private key\n" +
      "  Save as fcm-service-account.json in the repo root, then:\n" +
      "    eas credentials -p android\n" +
      "    → Google Service Account → FCM V1 → Upload a new service account key",
  );
} else {
  try {
    const key = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
    if (key.type !== "service_account" || !key.private_key) {
      fail("fcm-service-account.json does not look like a Google service account key");
    } else {
      ok(`fcm-service-account.json present (${key.client_email ?? "service account"})`);
      console.log(
        "\nNext: upload to EAS (interactive):\n" +
          "  eas credentials -p android\n" +
          "  → pick a build profile (development or production)\n" +
          "  → Google Service Account → Manage FCM V1 → Upload\n" +
          "  → select fcm-service-account.json\n" +
          "Then rebuild the Android binary (dev-client must include google-services.json).",
      );
    }
  } catch (error) {
    fail(`fcm-service-account.json is not valid JSON: ${error.message}`);
  }
}

if (process.exitCode) {
  console.log("\nRemote Android push will not work until both files are in place and EAS has the FCM key.");
  process.exit(process.exitCode);
}

console.log("\nAll local FCM files look good.");
