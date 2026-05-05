#!/usr/bin/env node
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_TARGET_WIDTH = 295;
const VIMEO_API_BASE = "https://api.vimeo.com";
const VIMEO_ACCEPT = "application/vnd.vimeo.*+json;version=3.4";

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

function vimeoToken() {
  const token =
    process.env.VIMEO_ACCESS_TOKEN?.trim() ||
    process.env.vimeo_token?.trim() ||
    process.env.VIMEO_TOKEN?.trim();
  if (!token) throw new Error("Missing Vimeo token. Set VIMEO_ACCESS_TOKEN or vimeo_token.");
  return token;
}

function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function pickBestVimeoThumbnail(sizes, targetWidth) {
  const normalized = (Array.isArray(sizes) ? sizes : [])
    .map((size) => ({
      url: typeof size?.link === "string" ? size.link.trim() : "",
      width: positiveNumber(size?.width),
      height: positiveNumber(size?.height),
    }))
    .filter((size) => size.url && size.width != null && size.height != null)
    .sort((a, b) => a.width - b.width);

  if (!normalized.length) return null;
  return normalized.find((size) => size.width >= targetWidth) ?? normalized[normalized.length - 1] ?? null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchVimeoThumbnail(videoId, targetWidth, attempt = 1) {
  try {
    const response = await fetch(`${VIMEO_API_BASE}/videos/${encodeURIComponent(videoId)}?fields=pictures`, {
      headers: {
        Authorization: `Bearer ${vimeoToken()}`,
        Accept: VIMEO_ACCEPT,
      },
    });

    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText);
      throw new Error(`Vimeo API error ${response.status}: ${message.slice(0, 280)}`);
    }

    const payload = await response.json();
    return pickBestVimeoThumbnail(payload?.pictures?.sizes, targetWidth);
  } catch (error) {
    if (attempt >= 4) throw error;
    await wait(600 * attempt);
    return fetchVimeoThumbnail(videoId, targetWidth, attempt + 1);
  }
}

function mergeThumbnailIntoParams(params, thumbnail) {
  const base = params && typeof params === "object" && !Array.isArray(params) ? params : {};
  return {
    ...base,
    video_thumbnail: thumbnail,
    video_thumbnail_fetched_at: new Date().toISOString(),
  };
}

function chunk(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function updatePracticeParams({ supabaseUrl, serviceRoleKey, id, params }, attempt = 1) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/practices?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ params }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText);
      throw new Error(`Supabase update error ${response.status}: ${message.slice(0, 280)}`);
    }
  } catch (error) {
    if (attempt >= 4) throw error;
    await wait(700 * attempt);
    return updatePracticeParams({ supabaseUrl, serviceRoleKey, id, params }, attempt + 1);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function main() {
  loadEnv();

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const targetWidthArg = process.argv.find((arg) => arg.startsWith("--width="));
  const dryRun = process.argv.includes("--dry-run");
  const limit = limitArg ? Number.parseInt(limitArg.slice("--limit=".length), 10) : null;
  const targetWidth = targetWidthArg ? Number.parseInt(targetWidthArg.slice("--width=".length), 10) : DEFAULT_TARGET_WIDTH;
  if (!Number.isInteger(targetWidth) || targetWidth <= 0) {
    throw new Error(`Invalid width: ${targetWidthArg}`);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = db
    .from("practices")
    .select("id,slug,params,video_external_id")
    .eq("kind", "yoga")
    .eq("is_active", true)
    .eq("video_provider", "vimeo")
    .not("video_external_id", "is", null)
    .order("slug", { ascending: true });
  if (limit != null && Number.isInteger(limit) && limit > 0) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? [])
    .filter((row) => typeof row.video_external_id === "string" && row.video_external_id.trim())
    .filter((row) => {
      const params = row.params && typeof row.params === "object" && !Array.isArray(row.params) ? row.params : null;
      return !(params?.video_thumbnail?.url && params?.video_thumbnail_fetched_at);
    });
  console.log(`Loaded ${rows.length} yoga practices.`);
  if (!rows.length) return;

  const updates = [];
  for (const row of rows) {
    const videoId = row.video_external_id.trim();
    let thumbnail = null;
    try {
      thumbnail = await fetchVimeoThumbnail(videoId, targetWidth);
    } catch (error) {
      console.warn(`Failed ${row.slug} (${videoId}): ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!thumbnail) {
      console.warn(`No thumbnail for ${row.slug} (${videoId})`);
      continue;
    }

    updates.push({
      id: row.id,
      slug: row.slug,
      params: mergeThumbnailIntoParams(row.params, thumbnail),
    });
    console.log(`Prepared ${row.slug} -> ${thumbnail.width}x${thumbnail.height}`);
  }

  console.log(`Prepared ${updates.length} updates.`);
  if (dryRun || !updates.length) return;

  for (const [index, batch] of chunk(updates, 10).entries()) {
    for (const row of batch) {
      await updatePracticeParams({
        supabaseUrl,
        serviceRoleKey,
        id: row.id,
        params: row.params,
      });
    }
    console.log(`Applied batch ${index + 1}/${Math.ceil(updates.length / 10)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
