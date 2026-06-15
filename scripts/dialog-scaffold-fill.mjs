#!/usr/bin/env node
/**
 * @deprecated Use `node scripts/i18n-sync.mjs fill --all` (RU-first, same gate as UI catalog).
 * This wrapper remains for backward-compatible invocations.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
console.warn("[dialog-scaffold-fill] Deprecated — delegating to i18n-sync.mjs fill --all");
const result = spawnSync("node", [join(root, "scripts/i18n-sync.mjs"), "fill", "--all"], {
  stdio: "inherit",
  cwd: root,
});
process.exit(result.status ?? 1);
