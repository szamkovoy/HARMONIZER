/**
 * i18n translation sync gate — keeps locale catalogs in sync with the Russian
 * source of truth. Mirrors the docs-sync philosophy: the deterministic part
 * (diff/check) is pure Node and always runs; the LLM `fill` is optional.
 *
 * Source of truth: modules/i18n/catalog/ru.json
 *                 _legacy_web/data/dialog_scaffold/ru.json (layer C server strings)
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

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureCatalogDir,
  extractModuleSource,
  readTypedManifest,
  unflatten,
  writeGeneratedRegistry,
  writeJson,
} from "./lib/i18n-typed.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CATALOG_DIR = join(__dirname, "..", "modules", "i18n", "catalog");
const SOURCE_LOCALE = "ru";
const REQUIRED_TARGETS = ["en"];
const OPTIONAL_TARGETS = ["de", "fr", "it", "es", "pt", "nl"];
const ALL_TARGETS = [...REQUIRED_TARGETS, ...OPTIONAL_TARGETS];
/** Typed modules keep RU + EN inline in TS; overlays are for de/fr/it/es/pt/nl only. */
const TYPED_OVERLAY_TARGETS = [...OPTIONAL_TARGETS];
const META_FILE = join(CATALOG_DIR, ".sync-meta.json");
const TYPED_META_FILE = join(REPO_ROOT, "modules/i18n/typed/.sync-meta.json");
const DIALOG_SCAFFOLD_DIR = join(REPO_ROOT, "_legacy_web/data/dialog_scaffold");
const DIALOG_SCAFFOLD_SOURCE = join(DIALOG_SCAFFOLD_DIR, "ru.json");
const DIALOG_SCAFFOLD_META_FILE = join(DIALOG_SCAFFOLD_DIR, ".sync-meta.json");

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

function localePath(locale) {
  return join(CATALOG_DIR, `${locale}.json`);
}

function dialogScaffoldPath(locale) {
  return join(DIALOG_SCAFFOLD_DIR, `${locale}.json`);
}

/** Diff one target against the source. */
function diffLocale(source, meta, locale, resolvePath = localePath) {
  const target = readJson(resolvePath(locale), {});
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

function runDialogScaffoldCheck(source, meta, hardFailLocales) {
  let hardFail = false;
  for (const locale of ALL_TARGETS) {
    const { missing, stale, orphan } = diffLocale(source, meta, locale, dialogScaffoldPath);
    if (missing.length || stale.length || orphan.length) {
      const tag = hardFailLocales.includes(locale) ? "FAIL" : "warn";
      console.log(
        `[i18n:dialog-scaffold] ${tag} ${locale}: ${missing.length} missing, ${stale.length} stale, ${orphan.length} orphan`,
      );
      if (missing.length) console.log(`        missing: ${missing.join(", ")}`);
      if (stale.length) console.log(`        stale:   ${stale.join(", ")}`);
      if (orphan.length) console.log(`        orphan:  ${orphan.join(", ")}`);
      if (hardFailLocales.includes(locale)) hardFail = true;
    }
  }
  return hardFail;
}

async function runDialogScaffoldFill(source, meta, targets) {
  for (const locale of targets) {
    const { target, missing, stale, orphan } = diffLocale(source, meta, locale, dialogScaffoldPath);
    const todo = [...missing, ...stale];
    for (const key of orphan) delete target[key];
    if (!todo.length && !orphan.length) {
      console.log(`[i18n:dialog-scaffold] ${locale}: up to date.`);
      continue;
    }
    console.log(
      `[i18n:dialog-scaffold] ${locale}: ${missing.length} missing + ${stale.length} stale to translate, ${orphan.length} orphan removed.`,
    );
    const entries = todo.map((key) => [key, source[key]]);
    let translated = null;
    try {
      translated = entries.length ? await translateBatch(locale, entries, "dialog-scaffold") : {};
    } catch (error) {
      console.error(`[i18n:dialog-scaffold] ${locale}: translation failed: ${error.message}`);
      process.exitCode = 1;
      continue;
    }
    if (translated == null) {
      console.log(`[i18n:dialog-scaffold] ${locale}: no translate API — plan only:`);
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
    writeJson(dialogScaffoldPath(locale), target);
  }
  writeJson(DIALOG_SCAFFOLD_META_FILE, meta);
}

function bootstrapDialogScaffoldMeta() {
  const source = readJson(DIALOG_SCAFFOLD_SOURCE, null);
  if (!source) {
    console.error(`[i18n:dialog-scaffold] Missing source ${DIALOG_SCAFFOLD_SOURCE}`);
    process.exit(1);
  }
  const meta = {};
  for (const locale of ALL_TARGETS) {
    const target = readJson(dialogScaffoldPath(locale), {});
    meta[locale] = {};
    for (const key of Object.keys(source)) {
      if (key in target) meta[locale][key] = source[key];
    }
  }
  writeJson(DIALOG_SCAFFOLD_META_FILE, meta);
  console.log(`[i18n:dialog-scaffold] Bootstrapped ${DIALOG_SCAFFOLD_META_FILE}`);
}

function diffTypedLocale(sourceFlat, meta, moduleId, locale) {
  const path = join(REPO_ROOT, "modules/i18n/typed/catalog", moduleId, `${locale}.json`);
  const targetFlat = existsSync(path) ? flatten(readJson(path, {})) : {};
  const localeMeta = meta?.[moduleId]?.[locale] ?? {};
  const missing = [];
  const stale = [];
  const orphan = [];
  for (const key of Object.keys(sourceFlat)) {
    if (!(key in targetFlat)) missing.push(key);
    else if (localeMeta[key] !== sourceFlat[key]) stale.push(key);
  }
  for (const key of Object.keys(targetFlat)) {
    if (!(key in sourceFlat)) orphan.push(key);
  }
  return { targetFlat, missing, stale, orphan };
}

function flatten(obj, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flatten(value, path));
    } else if (typeof value === "string") {
      out[path] = value;
    }
  }
  return out;
}

async function runTypedCheck(manifest, hardFailLocales) {
  const meta = readJson(TYPED_META_FILE, {});
  let hardFail = false;
  for (const entry of manifest) {
    const sourceFlat = extractModuleSource(REPO_ROOT, entry);
    if (!sourceFlat) {
      console.warn(`[i18n:typed] skip ${entry.id}: could not extract source`);
      continue;
    }
    for (const locale of TYPED_OVERLAY_TARGETS) {
      const { missing, stale, orphan } = diffTypedLocale(sourceFlat, meta, entry.id, locale);
      if (missing.length || stale.length || orphan.length) {
        const tag = hardFailLocales.includes(locale) ? "FAIL" : "warn";
        console.log(
          `[i18n:typed] ${tag} ${entry.id}/${locale}: ${missing.length} missing, ${stale.length} stale, ${orphan.length} orphan`,
        );
        if (hardFailLocales.includes(locale)) hardFail = true;
      }
    }
  }
  return hardFail;
}

async function runTypedFill(manifest, targets) {
  const meta = readJson(TYPED_META_FILE, {});
  for (const entry of manifest) {
    const sourceFlat = extractModuleSource(REPO_ROOT, entry);
    if (!sourceFlat) continue;
    ensureCatalogDir(REPO_ROOT, entry.id);
    for (const locale of targets) {
      const path = join(REPO_ROOT, "modules/i18n/typed/catalog", entry.id, `${locale}.json`);
      const { targetFlat, missing, stale, orphan } = diffTypedLocale(sourceFlat, meta, entry.id, locale);
      const todo = [...missing, ...stale];
      for (const key of orphan) delete targetFlat[key];
      if (!todo.length && !orphan.length) continue;
      console.log(`[i18n:typed] ${entry.id}/${locale}: ${todo.length} keys to translate`);
      const entries = todo.map((key) => [key, sourceFlat[key]]);
      let translated = null;
      try {
        translated = entries.length ? await translateBatch(locale, entries) : {};
      } catch (error) {
        console.error(`[i18n:typed] ${entry.id}/${locale}: ${error.message}`);
        process.exitCode = 1;
        continue;
      }
      if (translated == null) {
        for (const [key, value] of entries) console.log(`        ${key} = ${value}`);
        continue;
      }
      meta[entry.id] = meta[entry.id] ?? {};
      meta[entry.id][locale] = meta[entry.id][locale] ?? {};
      for (const [key] of entries) {
        if (translated[key] != null) {
          targetFlat[key] = String(translated[key]);
          meta[entry.id][locale][key] = sourceFlat[key];
        }
      }
      writeJson(path, unflatten(targetFlat));
    }
  }
  writeJson(TYPED_META_FILE, meta);
  writeGeneratedRegistry(REPO_ROOT, manifest);
}

function resolveTranslateEnv() {
  const deepseekBase = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  const explicitUrl = process.env.I18N_TRANSLATE_API_URL?.trim();
  const explicitKey = process.env.I18N_TRANSLATE_API_KEY?.trim();
  const explicitModel = process.env.I18N_TRANSLATE_MODEL?.trim();

  if (explicitUrl && explicitKey && explicitModel) {
    return { apiUrl: explicitUrl, apiKey: explicitKey, model: explicitModel };
  }

  if (deepseekKey) {
    let model =
      explicitModel ?? process.env.AI_MODEL_PREMIUM?.trim() ?? process.env.AI_MODEL_STANDARD?.trim() ?? "deepseek-v4-pro";
    if (!model.toLowerCase().includes("deepseek")) {
      model = "deepseek-v4-pro";
    }
    return {
      apiUrl: `${deepseekBase}/v1/chat/completions`,
      apiKey: deepseekKey,
      model,
    };
  }

  return {
    apiUrl: explicitUrl ?? null,
    apiKey: explicitKey ?? deepseekKey ?? null,
    model: explicitModel ?? process.env.AI_MODEL_PREMIUM?.trim() ?? process.env.AI_MODEL_STANDARD?.trim() ?? null,
  };
}

async function translateBatch(locale, entries, context = "catalog") {
  const { apiUrl, apiKey, model } = resolveTranslateEnv();
  if (!apiUrl || !apiKey || !model) return null;

  const languageName = LANGUAGE_NAMES[locale] ?? locale;
  const payload = Object.fromEntries(entries);
  const role =
    context === "dialog-scaffold"
      ? "server-side dialog assistant localizer"
      : "UI localizer";
  const system =
    `You are a professional ${role} for a yoga + psychology mobile app with a warm, ` +
    `empathetic mentor tone. Translate the JSON values from Russian into ${languageName}. ` +
    `Keep keys unchanged. Preserve {placeholders} verbatim. Keep it concise and natural. ` +
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

  if (command === "bootstrap-dialog-scaffold-meta") {
    bootstrapDialogScaffoldMeta();
    return;
  }

  const scaffoldSource = readJson(DIALOG_SCAFFOLD_SOURCE, null);
  const scaffoldMeta = readJson(DIALOG_SCAFFOLD_META_FILE, {});

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
    if (scaffoldSource) {
      if (runDialogScaffoldCheck(scaffoldSource, scaffoldMeta, REQUIRED_TARGETS)) hardFail = true;
    }
    const typedManifest = readTypedManifest(REPO_ROOT);
    await runTypedCheck(typedManifest, []); // overlays optional until locale enabled
    if (hardFail) {
      console.error("[i18n] Required locales are out of sync. Run: node scripts/i18n-sync.mjs fill --all");
      process.exit(1);
    }
    console.log("[i18n] Required locales in sync (catalog + dialog-scaffold + typed).");
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
        console.log(
          `[i18n] ${locale}: no translate API configured. Set I18N_TRANSLATE_API_* or DEEPSEEK_API_KEY + AI_MODEL_PREMIUM/STANDARD. Plan only:`,
        );
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
    if (scaffoldSource) await runDialogScaffoldFill(scaffoldSource, scaffoldMeta, targets);
    const typedManifest = readTypedManifest(REPO_ROOT);
    const typedTargets = targets.filter((l) => TYPED_OVERLAY_TARGETS.includes(l));
    if (typedTargets.length) await runTypedFill(typedManifest, typedTargets);
    console.log("[i18n] Fill complete (catalog + dialog-scaffold + typed).");
    return;
  }

  console.error(
    `[i18n] Unknown command "${command}". Use: check | fill | bootstrap-dialog-scaffold-meta`,
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(`[i18n] Unexpected error: ${error.stack ?? error}`);
  process.exit(1);
});
