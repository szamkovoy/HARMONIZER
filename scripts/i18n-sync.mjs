/**
 * i18n translation sync gate — keeps locale catalogs in sync with the Russian
 * source of truth. Mirrors the docs-sync philosophy: the deterministic part
 * (diff/check) is pure Node and always runs; the LLM `fill` is optional.
 *
 * Source of truth: modules/i18n/catalog/ru.json
 * Targets:         en (required) + de/fr/it/es/pt/nl (best-effort)
 *
 * Usage (from repo root):
 *   node scripts/i18n-sync.mjs check                 # fail if required locales drift
 *   node scripts/i18n-sync.mjs fill --locale en      # LLM-translate missing/stale keys
 *   node scripts/i18n-sync.mjs fill --all            # fill every target locale
 *
 * `fill` needs an OpenAI-compatible endpoint:
 *   I18N_TRANSLATE_API_URL, I18N_TRANSLATE_API_KEY, I18N_TRANSLATE_MODEL
 * Without it, `fill` prints the plan (the missing keys) and exits 0.
 *
 * The gate is diff-based: it acts only on keys whose Russian source is missing
 * or has changed since the last fill (tracked in .sync-meta.json), never on the
 * whole catalog. See docs/04_workspace/i18n_architecture.md.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = join(__dirname, "..", "modules", "i18n", "catalog");
const SOURCE_LOCALE = "ru";
const REQUIRED_TARGETS = ["en"];
const OPTIONAL_TARGETS = ["de", "fr", "it", "es", "pt", "nl"];
const ALL_TARGETS = [...REQUIRED_TARGETS, ...OPTIONAL_TARGETS];
const META_FILE = join(CATALOG_DIR, ".sync-meta.json");

const LANGUAGE_NAMES = {
  en: "English",
  de: "German",
  fr: "French",
  it: "Italian",
  es: "Spanish",
  pt: "Portuguese",
  nl: "Dutch",
};

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`[i18n] Cannot parse ${path}: ${error.message}`);
    process.exit(1);
  }
}

function writeJson(path, value) {
  // Stable key order keeps diffs small.
  const ordered = Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]]));
  writeFileSync(path, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
}

function localePath(locale) {
  return join(CATALOG_DIR, `${locale}.json`);
}

/** Diff one target against the source. */
function diffLocale(source, meta, locale) {
  const target = readJson(localePath(locale), {});
  const localeMeta = meta[locale] ?? {};
  const missing = []; // key in source, absent in target
  const stale = []; // key present but source text changed since last fill
  const orphan = []; // key in target no longer in source
  for (const key of Object.keys(source)) {
    if (!(key in target)) {
      missing.push(key);
    } else if (localeMeta[key] !== source[key]) {
      stale.push(key);
    }
  }
  for (const key of Object.keys(target)) {
    if (!(key in source)) orphan.push(key);
  }
  return { target, missing, stale, orphan };
}

async function translateBatch(locale, entries) {
  const apiUrl = process.env.I18N_TRANSLATE_API_URL;
  const apiKey = process.env.I18N_TRANSLATE_API_KEY;
  const model = process.env.I18N_TRANSLATE_MODEL;
  if (!apiUrl || !apiKey || !model) return null;

  const languageName = LANGUAGE_NAMES[locale] ?? locale;
  const payload = Object.fromEntries(entries);
  const system =
    `You are a professional UI localizer for a yoga + psychology mobile app with a warm, ` +
    `empathetic mentor tone. Translate the JSON values from Russian into ${languageName}. ` +
    `Keep keys unchanged. Preserve {placeholders} verbatim. Keep it concise and natural for UI. ` +
    `Return ONLY a JSON object with the same keys.`;
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload, null, 2) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`translate API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const jsonText = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(jsonText);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--all") args.all = true;
    else if (a === "--locale") args.locale = argv[(i += 1)];
    else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] ?? "check";
  const source = readJson(localePath(SOURCE_LOCALE), null);
  if (!source) {
    console.error(`[i18n] Missing source catalog ${localePath(SOURCE_LOCALE)}`);
    process.exit(1);
  }
  const meta = readJson(META_FILE, {});

  if (command === "check") {
    let hardFail = false;
    for (const locale of ALL_TARGETS) {
      const { missing, stale, orphan } = diffLocale(source, meta, locale);
      const required = REQUIRED_TARGETS.includes(locale);
      if (missing.length || stale.length || orphan.length) {
        const tag = required ? "FAIL" : "warn";
        console.log(
          `[i18n] ${tag} ${locale}: ${missing.length} missing, ${stale.length} stale, ${orphan.length} orphan`,
        );
        if (missing.length) console.log(`        missing: ${missing.join(", ")}`);
        if (stale.length) console.log(`        stale:   ${stale.join(", ")}`);
        if (orphan.length) console.log(`        orphan:  ${orphan.join(", ")}`);
        if (required) hardFail = true;
      }
    }
    if (hardFail) {
      console.error("[i18n] Required locales are out of sync. Run: node scripts/i18n-sync.mjs fill --all");
      process.exit(1);
    }
    console.log("[i18n] Required locales in sync.");
    return;
  }

  if (command === "fill") {
    const targets = args.all ? ALL_TARGETS : args.locale ? [args.locale] : REQUIRED_TARGETS;
    for (const locale of targets) {
      const { target, missing, stale, orphan } = diffLocale(source, meta, locale);
      const todo = [...missing, ...stale];
      // Drop orphan keys (no longer in source) to keep catalogs clean.
      for (const key of orphan) delete target[key];
      if (!todo.length && !orphan.length) {
        console.log(`[i18n] ${locale}: up to date.`);
        continue;
      }
      console.log(`[i18n] ${locale}: ${missing.length} missing + ${stale.length} stale to translate, ${orphan.length} orphan removed.`);
      const entries = todo.map((key) => [key, source[key]]);
      let translated = null;
      try {
        translated = entries.length ? await translateBatch(locale, entries) : {};
      } catch (error) {
        console.error(`[i18n] ${locale}: translation failed: ${error.message}`);
        process.exitCode = 1;
        continue;
      }
      if (translated == null) {
        console.log(`[i18n] ${locale}: no translate API configured (I18N_TRANSLATE_API_URL/_API_KEY/_MODEL). Plan only:`);
        for (const [key, value] of entries) console.log(`        ${key} = ${value}`);
        continue;
      }
      meta[locale] = meta[locale] ?? {};
      for (const [key] of entries) {
        if (translated[key] != null) {
          target[key] = String(translated[key]);
          meta[locale][key] = source[key];
        }
      }
      for (const key of orphan) delete meta[locale][key];
      writeJson(localePath(locale), target);
    }
    writeJson(META_FILE, meta);
    console.log("[i18n] Fill complete.");
    return;
  }

  console.error(`[i18n] Unknown command "${command}". Use: check | fill`);
  process.exit(1);
}

main().catch((error) => {
  console.error(`[i18n] Unexpected error: ${error.stack ?? error}`);
  process.exit(1);
});
