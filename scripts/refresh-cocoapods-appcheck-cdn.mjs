#!/usr/bin/env node
/**
 * Force-refresh the CocoaPods CDN shard that lists AppCheckCore versions.
 * Stale local cache + etag can stop at 11.2.0 while Firebase 12.15 needs ~> 11.3.
 * Used by eas-build-post-install (cloud); local EAS also gets a Podfile preamble
 * via plugins/with-ios-appcheckcore-cdn-refresh.js.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const POD = "AppCheckCore";
const md5 = crypto.createHash("md5").update(POD).digest("hex");
const shard = `${md5[0]}_${md5[1]}_${md5[2]}`;
const trunk = path.join(os.homedir(), ".cocoapods", "repos", "trunk");
const versionsPath = path.join(trunk, `all_pods_versions_${shard}.txt`);
const etagPath = `${versionsPath}.etag`;
const url = `https://cdn.cocoapods.org/all_pods_versions_${shard}.txt`;

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      })
      .on("error", reject);
  });
}

const cached = fs.existsSync(versionsPath) ? fs.readFileSync(versionsPath, "utf8") : "";
const ok = cached.includes(`${POD}/`) && cached.includes("/11.3");
if (ok) {
  console.log(`[refresh-cocoapods-appcheck-cdn] OK — ${POD} 11.3.x already in shard ${shard}`);
  process.exit(0);
}

console.log(`[refresh-cocoapods-appcheck-cdn] Refreshing shard ${shard} (missing ${POD} 11.3.x)...`);
fs.mkdirSync(trunk, { recursive: true });
try {
  fs.unlinkSync(etagPath);
} catch {
  /* ignore */
}
try {
  fs.unlinkSync(versionsPath);
} catch {
  /* ignore */
}

const body = await get(url);
fs.writeFileSync(versionsPath, body);
if (!body.includes(`${POD}/`) || !body.includes("/11.3")) {
  console.error(`[refresh-cocoapods-appcheck-cdn] CDN still missing ${POD} 11.3.x after refresh`);
  process.exit(1);
}
console.log(`[refresh-cocoapods-appcheck-cdn] Updated ${versionsPath}`);
