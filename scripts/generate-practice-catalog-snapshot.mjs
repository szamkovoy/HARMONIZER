#!/usr/bin/env node
// Generates modules/practices/data/yoga-catalog.snapshot.json from Supabase.
// Bundled into the app binary at build time so the Practices tab opens with
// instant counts (no Supabase round-trip, no "Собираем каталог..." spinner).
// Non-fatal: if Supabase is unreachable, the committed snapshot is kept.
//
// Reads EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY from .env.local
// (anon key is enough — RLS already allows anon to read active practices).
// Run via `npm run update-practice-catalog-snapshot` (also prepended to build scripts).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = resolve(ROOT, ".env.local");
const OUT_PATH = resolve(ROOT, "modules/practices/data/yoga-catalog.snapshot.json");

// Same select as loadYogaPractices() in modules/practices/core/catalog.ts.
const SELECT =
  "id,slug,title,default_duration_sec,rating,video_provider,video_external_id,video_thumbnail:params->video_thumbnail,chakra_ids:params->chakra_ids,primary_chakra_id:params->primary_chakra_id,recorded_at:params->recorded_at,practice_chakras(chakra_id,is_primary,weight)";

async function parseEnv(path) {
  if (!existsSync(path)) return {};
  const text = await readFile(path, "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function main() {
  const env = await parseEnv(ENV_PATH);
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    console.warn(
      "[update-practice-catalog-snapshot] EXPO_PUBLIC_SUPABASE_URL / ANON_KEY missing in .env.local — keeping committed snapshot.",
    );
    process.exit(0);
  }

  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/practices?select=${encodeURIComponent(
    SELECT,
  )}&kind=eq.yoga&is_active=eq.true&order=rating.desc.nullslast`;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 20_000);
  let res;
  try {
    res = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
  } catch (e) {
    console.warn(
      `[update-practice-catalog-snapshot] fetch failed (${e instanceof Error ? e.name : String(e)}) — keeping committed snapshot.`,
    );
    process.exit(0);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    console.warn(
      `[update-practice-catalog-snapshot] Supabase REST ${res.status} ${res.statusText} — keeping committed snapshot.`,
    );
    process.exit(0);
  }

  const rows = await res.json();
  if (!Array.isArray(rows)) {
    console.warn(
      "[update-practice-catalog-snapshot] unexpected response shape — keeping committed snapshot.",
    );
    process.exit(0);
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    count: rows.length,
    rows,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(
    `[update-practice-catalog-snapshot] wrote ${rows.length} yoga practices → ${OUT_PATH.replace(ROOT + "/", "")}`,
  );
}

main().catch((e) => {
  console.warn(
    `[update-practice-catalog-snapshot] unexpected error (${e instanceof Error ? e.message : String(e)}) — keeping committed snapshot.`,
  );
  process.exit(0);
});
