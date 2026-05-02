#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const DEFAULT_INPUT = "/Users/sergey/Downloads/probuzhdenie.json";
const ALL_CHAKRAS = [1, 2, 3, 4, 5, 6, 7];
const SOURCE = "vimeo_probuzhdenie_import";
const EMBED_ORIGIN = "https://zamkovoi.yoga";

function loadEnv(path = ".env.local") {
  if (!fs.existsSync(path)) return;
  const raw = fs.readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key]) continue;
    process.env[key] = value.replace(/^['"]|['"]$/g, "");
  }
}

function unique(values) {
  return [...new Set(values)];
}

function parseQuality(value) {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    throw new Error(`Invalid quality "${value}". Expected empty or 1..5.`);
  }
  return parsed;
}

function parseRecordedAt(title) {
  const match = title.match(/(?:^|[^0-9])([0-9]{4})(?:[^0-9]|$)/);
  if (!match) return null;
  const code = match[1];
  const month = code.slice(0, 2);
  const day = code.slice(2, 4);
  const year = month === "01" ? "2026" : "2025";
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return `${year}-${month}-${day}`;
}

function parseChakras(title) {
  const explicit = unique([...title.matchAll(/_и([1-7])/g)].map((match) => Number(match[1])));
  if (explicit.length) return explicit;

  if (/все|новолуние/i.test(title)) return ALL_CHAKRAS;

  const dateMatch = title.match(/(?:^|[^0-9])([0-9]{4})(?:[^0-9]|$)/);
  if (!dateMatch) return [];
  const prefixOffset = dateMatch[0].match(/^[^0-9]/) ? 1 : 0;
  const beforeDate = title.slice(0, dateMatch.index + prefixOffset);
  const fallback = beforeDate.match(/([1-7]+)[^1-7]*$/);
  return fallback ? unique(fallback[1].split("").map(Number)) : [];
}

function normalizeRow(row, index) {
  const vimeoId = String(row.vimeo_id ?? "").trim();
  const title = String(row.title ?? "").trim();
  const durationSec = Number.parseInt(String(row.duration_sec ?? ""), 10);
  if (!vimeoId) throw new Error(`Row ${index + 1}: vimeo_id is required.`);
  if (!title) throw new Error(`Row ${index + 1}: title is required.`);
  if (!Number.isInteger(durationSec) || durationSec <= 0) {
    throw new Error(`Row ${index + 1}: duration_sec must be a positive integer.`);
  }

  const chakraIds = parseChakras(title);
  if (!chakraIds.length) throw new Error(`Row ${index + 1}: cannot parse chakra ids from "${title}".`);

  const recordedAt = parseRecordedAt(title);
  const quality = parseQuality(row.quality);
  const vimeoUrl = `https://vimeo.com/${vimeoId}`;
  return {
    source_index: index + 1,
    vimeo_id: vimeoId,
    slug: `asana-vimeo-${vimeoId}`,
    title,
    chakra_ids: chakraIds,
    primary_chakra_id: chakraIds[0],
    recorded_at: recordedAt,
    duration_sec: durationSec,
    quality,
    description: typeof row.description === "string" && row.description.trim() ? row.description.trim() : null,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag) => typeof tag === "string" && tag.trim()) : [],
    vimeo_url: vimeoUrl,
  };
}

function toPractice(row) {
  return {
    slug: row.slug,
    kind: "yoga",
    title: {
      ru: row.title,
      en: row.title,
    },
    description: row.description
      ? {
          ru: row.description,
          en: row.description,
        }
      : {},
    default_duration_sec: row.duration_sec,
    min_duration_sec: row.duration_sec,
    max_duration_sec: row.duration_sec,
    params: {
      source: SOURCE,
      source_index: row.source_index,
      duration_policy: "fixed",
      vimeo_title: row.title,
      recorded_at: row.recorded_at,
      quality: row.quality,
      chakra_ids: row.chakra_ids,
      primary_chakra_id: row.primary_chakra_id,
      tags: row.tags,
      vimeo_embed: {
        origin: EMBED_ORIGIN,
        player_url_template: "https://player.vimeo.com/video/{vimeo_id}?audiotrack={audiotrack}",
        audiotrack_by_locale: {
          ru: "en",
          en: "en",
        },
        iframe: {
          width: 640,
          height: 360,
          frameborder: 0,
          allow: "autoplay; fullscreen",
          allowfullscreen: true,
        },
      },
    },
    video_provider: "vimeo",
    video_url: row.vimeo_url,
    video_external_id: row.vimeo_id,
    rating: row.quality,
    is_active: true,
    version: 1,
  };
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(label, operation, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(`${label} failed (${attempt}/${attempts}): ${error?.message ?? String(error)}`);
      if (attempt < attempts) await wait(800 * attempt);
    }
  }
  throw lastError;
}

async function main() {
  loadEnv();
  const input = process.argv[2] ?? DEFAULT_INPUT;
  const dryRun = process.argv.includes("--dry-run");
  const raw = JSON.parse(fs.readFileSync(input, "utf8"));
  if (!Array.isArray(raw)) throw new Error("Input must be a JSON array.");

  const rows = raw.map(normalizeRow);
  const duplicateIds = rows
    .map((row) => row.vimeo_id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length) {
    throw new Error(`Duplicate vimeo_id values: ${unique(duplicateIds).join(", ")}`);
  }

  const practices = rows.map(toPractice);
  const summary = {
    input,
    dryRun,
    count: rows.length,
    quality: rows.reduce((acc, row) => {
      const key = row.quality == null ? "null" : String(row.quality);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    chakraLinks: rows.reduce((sum, row) => sum + row.chakra_ids.length, 0),
    allChakraPractices: rows.filter((row) => row.chakra_ids.length === 7).map((row) => row.title),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (dryRun) return;

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const practiceChunks = chunks(practices, 5);
  for (const [index, chunk] of practiceChunks.entries()) {
    await withRetry(`upsert practices chunk ${index + 1}/${practiceChunks.length}`, async () => {
      const { error: upsertError } = await db.from("practices").upsert(chunk, { onConflict: "slug" });
      if (upsertError) throw upsertError;
    });
    console.log(`upserted practices ${index + 1}/${practiceChunks.length}`);
  }

  const slugs = rows.map((row) => row.slug);
  const practiceIds = [];
  const slugChunks = chunks(slugs, 30);
  for (const [index, chunk] of slugChunks.entries()) {
    const data = await withRetry(`select practices chunk ${index + 1}/${slugChunks.length}`, async () => {
      const { data, error: selectError } = await db
        .from("practices")
        .select("id,slug")
        .in("slug", chunk);
      if (selectError) throw selectError;
      return data ?? [];
    });
    practiceIds.push(...(data ?? []));
    console.log(`selected practices ${index + 1}/${slugChunks.length}`);
  }

  const idBySlug = new Map(practiceIds.map((row) => [row.slug, row.id]));
  const missing = rows.filter((row) => !idBySlug.has(row.slug));
  if (missing.length) throw new Error(`Missing practices after upsert: ${missing.map((row) => row.slug).join(", ")}`);

  const ids = rows.map((row) => idBySlug.get(row.slug));
  const idChunks = chunks(ids, 30);
  for (const [index, chunk] of idChunks.entries()) {
    await withRetry(`delete links chunk ${index + 1}/${idChunks.length}`, async () => {
      const { error: deleteLinksError } = await db.from("practice_chakras").delete().in("practice_id", chunk);
      if (deleteLinksError) throw deleteLinksError;
    });
    console.log(`deleted old chakra links ${index + 1}/${idChunks.length}`);
  }

  const links = rows.flatMap((row) => {
    const practiceId = idBySlug.get(row.slug);
    return row.chakra_ids.map((chakraId, index) => ({
      practice_id: practiceId,
      chakra_id: chakraId,
      is_primary: chakraId === row.primary_chakra_id,
      weight: index === 0 ? 1 : 0.7,
    }));
  });
  const linkChunks = chunks(links, 30);
  for (const [index, chunk] of linkChunks.entries()) {
    await withRetry(`insert links chunk ${index + 1}/${linkChunks.length}`, async () => {
      const { error: linkError } = await db.from("practice_chakras").insert(chunk);
      if (linkError) throw linkError;
    });
    console.log(`inserted chakra links ${index + 1}/${linkChunks.length}`);
  }

  console.log(`Imported ${rows.length} Vimeo asanas and ${links.length} chakra links.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
