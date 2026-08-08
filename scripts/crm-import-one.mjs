/**
 * Smoke-import one CRM user from import/Экспорт_всех_*.xlsx
 *
 *   node scripts/crm-import-one.mjs positivo@mail.ru
 *
 * Env: EXPO_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * - No OTP email (admin createUser + email_confirm)
 * - last_seen_at left null → admin «Только рассылки»
 * - trial_expires_at cleared
 * - unknown GetCourse group ids skipped (not linked; not stored)
 * - getcourse_last_activity_at from export; no crm_legacy_id
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnvFile(path) {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      let v = m[2].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  } catch {
    /* optional */
  }
}

loadEnvFile(join(root, ".env.local"));
loadEnvFile(join(root, "_legacy_web/.env.local"));

const emailArg = (process.argv[2] || "").trim().toLowerCase();
if (!emailArg.includes("@")) {
  console.error("Usage: node scripts/crm-import-one.mjs <email>");
  process.exit(1);
}

const supabaseUrl = (
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !serviceKey) {
  console.error("Missing Supabase URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const COUNTRY = {
  россия: "RU",
  russia: "RU",
  рф: "RU",
  кыргызстан: "KG",
  австрия: "AT",
  израиль: "IL",
  беларусь: "BY",
  украина: "UA",
  казахстан: "KZ",
  сша: "US",
  нидерланды: "NL",
  германия: "DE",
};

function parseXlsxZip(path) {
  const dir = mkdtempSync(join(tmpdir(), "crm-xlsx-"));
  try {
    execFileSync("unzip", ["-o", "-q", path, "-d", dir]);
    const sheet = readFileSync(join(dir, "xl/worksheets/sheet1.xml"), "utf8");
    let shared = [];
    try {
      const ss = readFileSync(join(dir, "xl/sharedStrings.xml"), "utf8");
      shared = [...ss.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
        [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(""),
      );
    } catch {
      /* none */
    }
    const colToNum = (c) => {
      let n = 0;
      for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64);
      return n;
    };
    const numToCol = (n) => {
      let s = "";
      while (n) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
      }
      return s;
    };
    const rows = [];
    for (const rm of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = {};
      // Include self-closing empty cells so column letters stay aligned.
      for (const cm of rm[1].matchAll(
        /<c r="([A-Z]+)(\d+)"([^>]*)\/>|<c r="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g,
      )) {
        const col = cm[1] || cm[4];
        const attrs = cm[3] || cm[6] || "";
        const body = cm[7] || "";
        let val = null;
        if (/t="inlineStr"/.test(attrs)) {
          const tm = body.match(/<t[^>]*>([^<]*)<\/t>/);
          val = tm ? tm[1] : "";
        } else if (/t="s"/.test(attrs)) {
          const vm = body.match(/<v>([^<]*)<\/v>/);
          val = vm ? shared[Number(vm[1])] : null;
        } else {
          const vm = body.match(/<v>([^<]*)<\/v>/);
          val = vm ? vm[1] : null;
        }
        cells[col] = val;
      }
      if (!Object.keys(cells).length) continue;
      const maxc = Math.max(...Object.keys(cells).map(colToNum));
      rows.push([...Array(maxc)].map((_, i) => cells[numToCol(i + 1)] ?? null));
    }
    return rows;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function findExportFile() {
  const dir = join(root, "import");
  const files = readdirSync(dir)
    .filter((f) => f.includes("Экспорт_всех") && f.endsWith(".xlsx"))
    .sort();
  if (!files.length) throw new Error("No Экспорт_всех_*.xlsx in import/");
  return join(dir, files[files.length - 1]);
}

function toIso(raw) {
  if (!raw) return null;
  const d = new Date(String(raw).trim().replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapCountry(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  if (/^[a-z]{2}$/i.test(key)) return key.toUpperCase();
  return COUNTRY[key] ?? null;
}

async function findAuthUserId(email) {
  // Paginate admin list (small project / smoke). Prefer exact match.
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = (data?.users ?? []).find((u) => (u.email || "").toLowerCase() === email);
    if (hit) return hit.id;
    if ((data?.users ?? []).length < 200) break;
  }
  return null;
}

async function main() {
  const file = findExportFile();
  console.log("file", file);
  const rows = parseXlsxZip(file);
  const header = rows[0].map((h) => (h || "").trim());
  const idx = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Missing column ${name}`);
    return i;
  };

  const iEmail = idx("Email");
  const iCreated = idx("Создан");
  const iActivity = idx("Последняя активность");
  const iName = idx("Имя");
  const iLast = idx("Фамилия");
  const iPhone = idx("Телефон");
  const iBirth = idx("Дата рождения");
  const iCountry = idx("Страна");
  const iCity = idx("Город");
  const iId = idx("id");
  const iGroups = idx("id групп пользователя");

  const row = rows
    .slice(1)
    .find((r) => (r[iEmail] || "").trim().toLowerCase() === emailArg);
  if (!row) {
    console.error("Email not found:", emailArg);
    process.exit(1);
  }

  const email = emailArg;
  const crmLegacyId = String(row[iId] || "").trim() || null;
  const displayName = (row[iName] || "").trim() || null;
  const lastName = (row[iLast] || "").trim() || null;
  const phone = (row[iPhone] || "").trim() || null;
  const city = (row[iCity] || "").trim() || null;
  const countryCode = mapCountry(row[iCountry]);
  const createdAt = toIso(row[iCreated]);
  const crmActivity = toIso(row[iActivity]);
  const birthRaw = (row[iBirth] || "").trim();
  const birthDate =
    birthRaw && /^\d{4}-\d{2}-\d{2}/.test(birthRaw) ? birthRaw.slice(0, 10) : null;
  const groupIds = String(row[iGroups] || "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));

  console.log("CRM row", {
    email,
    crmLegacyId,
    displayName,
    lastName,
    phone,
    countryCode,
    city,
    createdAt,
    crmActivity,
    groupIds,
  });

  const { data: legacyMap, error: mapErr } = await db
    .from("crm_product_legacy_ids")
    .select("legacy_group_id, product_id, crm_products(slug, title)")
    .in("legacy_group_id", groupIds.length ? groupIds : [-1]);
  if (mapErr) throw mapErr;

  const productIds = [
    ...new Set((legacyMap ?? []).map((r) => r.product_id).filter(Boolean)),
  ];
  const productTitles = (legacyMap ?? [])
    .map((r) => {
      const p = Array.isArray(r.crm_products) ? r.crm_products[0] : r.crm_products;
      return p?.title;
    })
    .filter(Boolean);
  const unknownGroups = groupIds.filter(
    (g) => !(legacyMap ?? []).some((r) => Number(r.legacy_group_id) === g),
  );
  console.log("products", productTitles);
  console.log("unknown skipped", unknownGroups);

  let userId = await findAuthUserId(email);
  if (!userId) {
    const created = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: displayName || undefined, crm_import: true },
    });
    if (created.error) throw created.error;
    userId = created.data.user.id;
    console.log("created auth user", userId);
  } else {
    console.log("existing auth user", userId);
  }

  // Wait for handle_new_auth_user trigger
  for (let i = 0; i < 10; i += 1) {
    const { data } = await db.from("users").select("id").eq("id", userId).maybeSingle();
    if (data?.id) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  const { data: existing } = await db
    .from("users")
    .select("birth_date, onboarded_at, last_seen_at, admin_note")
    .eq("id", userId)
    .maybeSingle();

  const patch = {
    display_name: displayName,
    last_name: lastName,
    phone,
    country_code: countryCode,
    city,
    crm_imported_at: new Date().toISOString(),
    getcourse_last_activity_at: crmActivity || null,
    trial_expires_at: null,
    membership_tier: "free",
  };
  if (createdAt) patch.created_at = createdAt;
  if (birthDate && !existing?.birth_date) patch.birth_date = birthDate;

  // CRM-only: keep funnel empty so UI shows «Только рассылки»
  if (!existing?.onboarded_at && !existing?.last_seen_at) {
    patch.last_seen_at = null;
    patch.onboarded_at = null;
  }

  const { error: upErr } = await db.from("users").update(patch).eq("id", userId);
  if (upErr) throw upErr;

  if (productIds.length) {
    const { error: linkErr } = await db.from("user_crm_products").upsert(
      productIds.map((product_id) => ({ user_id: userId, product_id })),
      { onConflict: "user_id,product_id" },
    );
    if (linkErr) throw linkErr;
  }

  const { error: syncErr } = await db.rpc("sync_email_contacts_from_users");
  if (syncErr) console.warn("sync_email_contacts:", syncErr.message);

  const { data: finalUser, error: finalErr } = await db
    .from("users")
    .select(
      "id, display_name, last_name, phone, country_code, city, created_at, onboarded_at, last_seen_at, crm_imported_at, getcourse_last_activity_at, trial_expires_at, membership_tier, admin_note",
    )
    .eq("id", userId)
    .single();
  if (finalErr) throw finalErr;

  const { data: links } = await db
    .from("user_crm_products")
    .select("crm_products(title, slug)")
    .eq("user_id", userId);

  console.log("OK user", finalUser);
  console.log(
    "OK courses",
    (links ?? []).map((l) => {
      const p = Array.isArray(l.crm_products) ? l.crm_products[0] : l.crm_products;
      return p?.title;
    }),
  );
  console.log("admin url path", `/admin/users/${userId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
