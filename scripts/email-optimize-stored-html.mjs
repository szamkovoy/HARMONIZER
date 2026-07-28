/**
 * One-shot: re-sanitize stored marketing email HTML from blocks_i18n
 * (campaigns + automation steps). Does not cancel subscriptions / send mail.
 *
 * Usage: node scripts/email-optimize-stored-html.mjs
 * Env: NEXT_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  for (const rel of [".env.local", "_legacy_web/.env.local"]) {
    const p = resolve(root, rel);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Inline sanitize (keep in sync with emailRichHtml.ts) — avoid TS path wiring in node.
import { pathToFileURL } from "node:url";

async function loadSanitize() {
  // Run with: npx tsx scripts/email-optimize-stored-html.mjs
  const mod = await import(
    pathToFileURL(resolve(root, "_legacy_web/app/api/_utils/emailRichHtml.ts")).href
  );
  const blocksMod = await import(
    pathToFileURL(resolve(root, "_legacy_web/app/admin/email/_lib/blocks.ts")).href
  );
  return {
    sanitizeEmailRichHtml: mod.sanitizeEmailRichHtml,
    sanitizeEmailBlocks: blocksMod.sanitizeEmailBlocks,
    blocksToHtml: blocksMod.blocksToHtml,
    parseBlocksI18n: blocksMod.parseBlocksI18n,
  };
}

function cleanBlocksI18n(parseBlocksI18n, sanitizeEmailBlocks, blocksToHtml, raw) {
  const byLocale = parseBlocksI18n(raw);
  const next = {};
  let htmlRu = null;
  const htmlI18n = {};
  for (const [locale, blocks] of Object.entries(byLocale)) {
    const cleaned = sanitizeEmailBlocks(blocks);
    next[locale] = cleaned;
    const html = blocksToHtml(cleaned);
    if (locale === "ru") htmlRu = html;
    else htmlI18n[locale] = html;
  }
  return { blocks_i18n: next, htmlRu, htmlI18n };
}

const db = createClient(url, key, { auth: { persistSession: false } });
const {
  sanitizeEmailBlocks,
  blocksToHtml,
  parseBlocksI18n,
} = await loadSanitize();

let stepsUpdated = 0;
let campaignsUpdated = 0;

{
  const { data: steps, error } = await db
    .from("email_automation_steps")
    .select("id, html_body, html_body_i18n, blocks_i18n");
  if (error) throw error;
  for (const row of steps ?? []) {
    if (!row.blocks_i18n || typeof row.blocks_i18n !== "object") continue;
    const before = row.html_body?.length ?? 0;
    const { blocks_i18n, htmlRu, htmlI18n } = cleanBlocksI18n(
      parseBlocksI18n,
      sanitizeEmailBlocks,
      blocksToHtml,
      row.blocks_i18n,
    );
    const nextHtml = htmlRu ?? row.html_body;
    const nextI18n = { ...(row.html_body_i18n ?? {}), ...htmlI18n };
    if (nextHtml === row.html_body && JSON.stringify(blocks_i18n) === JSON.stringify(row.blocks_i18n)) {
      continue;
    }
    const { error: upErr } = await db
      .from("email_automation_steps")
      .update({
        blocks_i18n,
        html_body: nextHtml,
        html_body_i18n: nextI18n,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (upErr) throw upErr;
    stepsUpdated += 1;
    console.log(`step ${row.id}: ${before} → ${nextHtml?.length ?? 0} chars`);
  }
}

{
  const { data: campaigns, error } = await db
    .from("email_campaigns")
    .select("id, html_body, html_body_i18n, blocks_i18n");
  if (error) throw error;
  for (const row of campaigns ?? []) {
    if (!row.blocks_i18n || typeof row.blocks_i18n !== "object") continue;
    const before = row.html_body?.length ?? 0;
    const { blocks_i18n, htmlRu, htmlI18n } = cleanBlocksI18n(
      parseBlocksI18n,
      sanitizeEmailBlocks,
      blocksToHtml,
      row.blocks_i18n,
    );
    const nextHtml = htmlRu ?? row.html_body;
    const nextI18n = { ...(row.html_body_i18n ?? {}), ...htmlI18n };
    if (nextHtml === row.html_body && JSON.stringify(blocks_i18n) === JSON.stringify(row.blocks_i18n)) {
      continue;
    }
    const { error: upErr } = await db
      .from("email_campaigns")
      .update({
        blocks_i18n,
        html_body: nextHtml,
        html_body_i18n: nextI18n,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (upErr) throw upErr;
    campaignsUpdated += 1;
    console.log(`campaign ${row.id}: ${before} → ${nextHtml?.length ?? 0} chars`);
  }
}

console.log(`Done. steps=${stepsUpdated} campaigns=${campaignsUpdated}`);
