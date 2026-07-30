#!/usr/bin/env node
/**
 * Preflight: required EXPO_PUBLIC_* client vars must exist on EAS for the
 * given environment before a store/test build. Local .env.local is never
 * uploaded to EAS — missing production vars = blank Supabase in the AAB/IPA.
 *
 * Usage:
 *   node scripts/check-eas-client-env.mjs              # production
 *   node scripts/check-eas-client-env.mjs preview
 *   node scripts/check-eas-client-env.mjs development
 */
import { spawnSync } from "node:child_process";

const environment = (process.argv[2] || "production").trim();
const REQUIRED = [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_COMMUNICATOR_API_URL",
];

const result = spawnSync(
  "npx",
  ["eas-cli", "env:list", "--environment", environment],
  { encoding: "utf8", shell: true },
);

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || "eas env:list failed");
  process.exit(1);
}

const text = `${result.stdout}\n${result.stderr}`;
const present = new Set(
  [...text.matchAll(/^([A-Z0-9_]+)=/gm)].map((match) => match[1]),
);

const missing = REQUIRED.filter((name) => !present.has(name));
if (missing.length) {
  console.error(
    `[check-eas-client-env] Missing on EAS "${environment}":\n  - ${missing.join("\n  - ")}\n` +
      `Add with:\n  npx eas-cli env:create --name <NAME> --value <VALUE> --environment ${environment} --visibility plaintext --non-interactive\n` +
      `Then rebuild — .env.local is NOT used by cloud EAS builds.`,
  );
  process.exit(1);
}

console.log(
  `[check-eas-client-env] OK — ${REQUIRED.join(", ")} present on EAS "${environment}".`,
);
