#!/usr/bin/env node
/**
 * Pre-download RN 0.81 Maven tarballs used by iOS `pod install` (precompiled
 * ReactNativeDependencies, React-Core-prebuilt, Hermes). CocoaPods' default
 * curl often stalls ~19KB into repo1.maven.org (curl 56); HTTP/1.1 + retries +
 * mirrors + a durable cache avoids that during EAS local Archive.
 *
 * Cache: $HARMONIZER_RN_ARTIFACTS_DIR or ~/.cache/harmonizer/react-native-artifacts/<version>/
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const rnPkg = JSON.parse(
  fs.readFileSync(path.join(root, "node_modules", "react-native", "package.json"), "utf8"),
);
const VERSION = String(rnPkg.version);
const MIN_BYTES = 1_000_000;

const MIRRORS = [
  "https://maven-central.storage-download.googleapis.com/maven2",
  "https://maven.aliyun.com/repository/central",
  "https://repo.maven.apache.org/maven2",
  "https://repo1.maven.org/maven2",
];

const ARTIFACTS = [
  `react-native-artifacts-${VERSION}-reactnative-dependencies-debug.tar.gz`,
  `react-native-artifacts-${VERSION}-reactnative-dependencies-release.tar.gz`,
  `react-native-artifacts-${VERSION}-reactnative-core-debug.tar.gz`,
  `react-native-artifacts-${VERSION}-reactnative-core-release.tar.gz`,
  `react-native-artifacts-${VERSION}-hermes-ios-debug.tar.gz`,
  `react-native-artifacts-${VERSION}-hermes-ios-release.tar.gz`,
];

function cacheDir() {
  const env = (process.env.HARMONIZER_RN_ARTIFACTS_DIR || "").trim();
  if (env) return env;
  return path.join(os.homedir(), ".cache", "harmonizer", "react-native-artifacts", VERSION);
}

function curlHasFlag(flag) {
  const help = spawnSync("curl", ["--help", "all"], { encoding: "utf8" });
  const text = `${help.stdout || ""}\n${help.stderr || ""}`;
  return text.includes(flag);
}

const HAS_RETRY_ALL = curlHasFlag("--retry-all-errors");

function download(url, destPart, extraArgs) {
  const args = [
    "--fail",
    "--location",
    "--http1.1",
    ...(HAS_RETRY_ALL ? ["--retry-all-errors"] : []),
    "--retry",
    "1",
    "--retry-delay",
    "2",
    "--connect-timeout",
    "20",
    "--max-time",
    "600",
    "--speed-limit",
    "2048",
    "--speed-time",
    "30",
    "--continue-at",
    "-",
    "-o",
    destPart,
    ...extraArgs,
    url,
  ];
  console.log(`[prefetch-rn-ios] curl ${url}`);
  const result = spawnSync("curl", args, { stdio: "inherit" });
  return result.status === 0;
}

function isComplete(file) {
  try {
    return fs.statSync(file).size >= MIN_BYTES;
  } catch {
    return false;
  }
}

function fetchOne(filename, destDir) {
  const dest = path.join(destDir, filename);
  if (isComplete(dest)) {
    console.log(`[prefetch-rn-ios] cached ${filename} (${fs.statSync(dest).size} bytes)`);
    return;
  }
  const part = `${dest}.part`;
  const extraPasses = [[], ["--ipv4"]];
  for (const extra of extraPasses) {
    for (const mirror of MIRRORS) {
      const url = `${mirror}/com/facebook/react/react-native-artifacts/${VERSION}/${filename}`;
      try {
        fs.unlinkSync(part);
      } catch {
        /* ignore */
      }
      if (download(url, part, extra) && isComplete(part)) {
        fs.renameSync(part, dest);
        console.log(`[prefetch-rn-ios] saved ${filename} (${fs.statSync(dest).size} bytes)`);
        return;
      }
    }
  }
  try {
    fs.unlinkSync(part);
  } catch {
    /* ignore */
  }
  throw new Error(
    `[prefetch-rn-ios] failed to download ${filename}. Check Maven Central / retry: node scripts/prefetch-rn-ios-artifacts.mjs`,
  );
}

const dir = cacheDir();
fs.mkdirSync(dir, { recursive: true });
console.log(`[prefetch-rn-ios] RN ${VERSION} → ${dir}`);
for (const name of ARTIFACTS) {
  fetchOne(name, dir);
}
console.log("[prefetch-rn-ios] OK");
