/**
 * Выгрузка активных строк public.prompts в JSON (для отката перед миграцией промптов).
 *
 * Запуск из корня репозитория (нужны URL и service role в .env.local):
 *   node --env-file=.env.local scripts/backup-active-prompts.mjs
 *   node --env-file=.env.local scripts/backup-active-prompts.mjs supabase/backups/my_backup.json
 */

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const defaultOut = join(root, "supabase", "backups", "prompts_backup_before_dialog_quality_v4.json");
const outFile = process.argv[2] ? join(root, process.argv[2]) : defaultOut;

const url =
  process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
  process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !key) {
  console.error(
    "Нужны переменные: SUPABASE_SERVICE_ROLE_KEY и один из URL — EXPO_PUBLIC_SUPABASE_URL | NEXT_PUBLIC_SUPABASE_URL | SUPABASE_URL",
  );
  process.exit(1);
}

mkdirSync(dirname(outFile), { recursive: true });

const sb = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await sb.from("prompts").select("*").eq("is_active", true);
if (error) {
  console.error(error);
  process.exit(1);
}

const payload = {
  exported_at: new Date().toISOString(),
  table: "public.prompts",
  filter: { is_active: true },
  row_count: data?.length ?? 0,
  rows: data ?? [],
};

writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8");
console.log(`OK: ${payload.row_count} rows → ${outFile}`);
