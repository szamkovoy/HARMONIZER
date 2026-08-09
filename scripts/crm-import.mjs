/**
 * Bulk CRM import from import/*.xlsx (GetCourse exports).
 *
 *   node scripts/crm-import.mjs --file "Удаленные_28.11.2024.xlsx"
 *   node scripts/crm-import.mjs --file "Экспорт_всех_2026-08-08.xlsx" --with-groups
 *   node scripts/crm-import.mjs --all-deleted   # all Удал* without groups
 *   node scripts/crm-import.mjs --dry-run --file "…"
 *
 * Rules:
 * - No OTP / invite email (auth.admin.createUser + email_confirm)
 * - Groups/courses only when --with-groups and column present (Экспорт_всех)
 * - Live Harmonizer users (onboarded_at|last_seen_at): keep name/city/country;
 *   still set phone + course links; do not reset membership/trial
 * - CRM-only: email_only segment (crm_imported_at, null onboarded/last_seen)
 * - Within merge: freshest «Последняя активность» wins for profile fields
 *
 * Env: SUPABASE URL + SUPABASE_SERVICE_ROLE_KEY (.env.local)
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

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const withGroups = args.includes("--with-groups");
const allDeleted = args.includes("--all-deleted");
const fileIdx = args.indexOf("--file");
const fileArg = fileIdx >= 0 ? args[fileIdx + 1] : null;

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
  испания: "ES",
  италия: "IT",
  франция: "FR",
  португалия: "PT",
  польша: "PL",
  турция: "TR",
  грузия: "GE",
  армения: "AM",
  азербайджан: "AZ",
  узбекистан: "UZ",
  латвия: "LV",
  литва: "LT",
  эстония: "EE",
  чехия: "CZ",
  финляндия: "FI",
  швеция: "SE",
  норвегия: "NO",
  великобритания: "GB",
  англия: "GB",
  канада: "CA",
  австралия: "AU",
  оаэ: "AE",
  таиланд: "TH",
  индия: "IN",
  китай: "CN",
  японния: "JP",
  япония: "JP",
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

function toIso(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  // Excel serial date
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const ms = Math.round((n - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
  }
  const d = new Date(s.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapCountry(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  if (/^[a-z]{2}$/i.test(key)) return key.toUpperCase();
  return COUNTRY[key] ?? null;
}

function isDeletedFileName(name) {
  return /^удал/i.test(name.normalize("NFC"));
}

function resolveFiles() {
  const importDir = join(root, "import");
  const all = readdirSync(importDir).filter((f) => f.endsWith(".xlsx"));
  if (fileArg) {
    const hit = all.find((f) => f === fileArg || f.includes(fileArg));
    if (!hit) throw new Error(`File not found in import/: ${fileArg}`);
    return [join(importDir, hit)];
  }
  if (allDeleted) {
    return all
      .filter((f) => isDeletedFileName(f) && !f.includes("Экспорт_всех"))
      .sort()
      .map((f) => join(importDir, f));
  }
  throw new Error("Specify --file <name.xlsx> or --all-deleted");
}

function parseFileRows(path, { allowGroups }) {
  const rows = parseXlsxZip(path);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => (h || "").trim());
  const idx = (name, optional = false) => {
    const i = header.indexOf(name);
    if (i < 0) {
      if (optional) return -1;
      throw new Error(`${path}: missing column «${name}»`);
    }
    return i;
  };

  const iEmail = idx("Email");
  const iCreated = idx("Создан", true);
  const iActivity = idx("Последняя активность", true);
  const iName = idx("Имя", true);
  const iLast = idx("Фамилия", true);
  const iPhone = idx("Телефон", true);
  const iBirth = idx("Дата рождения", true);
  const iCountry = idx("Страна", true);
  const iCity = idx("Город", true);
  const iGroups = allowGroups ? idx("id групп пользователя", true) : -1;

  const out = [];
  for (const r of rows.slice(1)) {
    const email = String(r[iEmail] || "")
      .trim()
      .toLowerCase();
    if (!email.includes("@")) continue;
    const activityAt = iActivity >= 0 ? toIso(r[iActivity]) : null;
    const createdAt = iCreated >= 0 ? toIso(r[iCreated]) : null;
    const birthRaw = iBirth >= 0 ? String(r[iBirth] || "").trim() : "";
    const birthDate =
      birthRaw && /^\d{4}-\d{2}-\d{2}/.test(birthRaw) ? birthRaw.slice(0, 10) : null;
    let groupIds = [];
    if (iGroups >= 0 && r[iGroups]) {
      groupIds = String(r[iGroups])
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isFinite(n));
    }
    out.push({
      email,
      displayName: iName >= 0 ? String(r[iName] || "").trim() || null : null,
      lastName: iLast >= 0 ? String(r[iLast] || "").trim() || null : null,
      phone: iPhone >= 0 ? String(r[iPhone] || "").trim() || null : null,
      city: iCity >= 0 ? String(r[iCity] || "").trim() || null : null,
      countryCode: iCountry >= 0 ? mapCountry(r[iCountry]) : null,
      createdAt,
      activityAt,
      birthDate,
      groupIds,
      sourceFile: path.split("/").pop(),
    });
  }
  return out;
}

/** Fresher activity wins; null activity loses to any dated row. */
function mergeByEmail(records) {
  const map = new Map();
  for (const rec of records) {
    const prev = map.get(rec.email);
    if (!prev) {
      map.set(rec.email, { ...rec, groupIds: [...rec.groupIds] });
      continue;
    }
    const prevTs = prev.activityAt ? Date.parse(prev.activityAt) : -Infinity;
    const nextTs = rec.activityAt ? Date.parse(rec.activityAt) : -Infinity;
    const takeProfile = nextTs >= prevTs;
    const merged = takeProfile
      ? {
          ...rec,
          groupIds: [...new Set([...prev.groupIds, ...rec.groupIds])],
        }
      : {
          ...prev,
          groupIds: [...new Set([...prev.groupIds, ...rec.groupIds])],
          // Prefer non-null phone if winner lacks it
          phone: prev.phone || rec.phone,
        };
    // Courses from any file that carried groups (Экспорт_всех); union already above.
    map.set(rec.email, merged);
  }
  return [...map.values()];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(thenable, ms, label) {
  let timer;
  const promise = Promise.resolve(thenable);
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout ${label} (${ms}ms)`)), ms);
    }),
  ]);
}

async function withRetry(fn, { tries = 6, label = "op" } = {}) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e?.message || String(e);
      if (/terminated|disabled|banned|invalid.(email|format)|not allowed/i.test(msg)) {
        throw e;
      }
      const wait = Math.min(60_000, 1500 * 2 ** i);
      console.warn(`retry ${label} ${i + 1}/${tries} in ${wait}ms:`, msg.slice(0, 160));
      await sleep(wait);
    }
  }
  throw last;
}

/** Fast email→id map via email_contacts (listUsers pagination hangs on large auth DBs). */
async function loadEmailIdMap() {
  return withRetry(
    async () => {
      const map = new Map();
      const pageSize = 1000;
      for (let from = 0; from < 200_000; from += pageSize) {
        const { data, error } = await withTimeout(
          db
            .from("email_contacts")
            .select("email, user_id")
            .not("user_id", "is", null)
            .range(from, from + pageSize - 1),
          120_000,
          `email_contacts ${from}`,
        );
        if (error) throw error;
        const rows = data ?? [];
        for (const r of rows) {
          if (r.email && r.user_id) map.set(String(r.email).toLowerCase(), r.user_id);
        }
        if (rows.length < pageSize) break;
        if ((from / pageSize) % 5 === 0) {
          console.log("  cached email_contacts", from + rows.length, "emails", map.size);
        }
      }
      return map;
    },
    { tries: 8, label: "loadEmailIdMap" },
  );
}

/** Resolve auth user id without listUsers / without sending mail. */
async function resolveUserIdByEmail(email) {
  const { data, error } = await withTimeout(
    db.auth.admin.generateLink({ type: "magiclink", email }),
    45_000,
    `generateLink ${email}`,
  );
  if (error) throw error;
  const id = data?.user?.id;
  if (!id) throw new Error(`generateLink returned no user for ${email}`);
  return id;
}

async function loadGroupProductMap(groupIds) {
  const unique = [...new Set(groupIds)];
  if (!unique.length) return new Map();
  const { data, error } = await db
    .from("crm_product_legacy_ids")
    .select("legacy_group_id, product_id")
    .in("legacy_group_id", unique);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [Number(r.legacy_group_id), r.product_id]));
}

async function ensureUserRow(userId) {
  for (let i = 0; i < 15; i += 1) {
    const { data } = await db.from("users").select("id").eq("id", userId).maybeSingle();
    if (data?.id) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`users row missing for ${userId}`);
}

async function createAuthUser(rec) {
  return withRetry(
    async () => {
      const created = await withTimeout(
        db.auth.admin.createUser({
          email: rec.email,
          email_confirm: true,
          user_metadata: {
            full_name: rec.displayName || undefined,
            crm_import: true,
          },
        }),
        45_000,
        `createUser ${rec.email}`,
      );
      if (created.error) {
        const msg = created.error.message || String(created.error);
        // Retry transient Auth / network pressure; return other errors to caller.
        if (/rate|429|timeout|fetch failed|ECONNRESET|ETIMEDOUT|503|502|overloaded/i.test(msg)) {
          throw created.error;
        }
      }
      return created;
    },
    { label: `createUser ${rec.email}` },
  );
}

async function importOne(rec, emailMap, productByGroup, stats) {
  let userId = emailMap.get(rec.email) || null;
  if (!userId) {
    if (dryRun) {
      stats.wouldCreate += 1;
      return;
    }
    const created = await createAuthUser(rec);
    if (created.error) {
      const msg = created.error.message || String(created.error);
      if (/already|registered|exists/i.test(msg)) {
        userId = await resolveUserIdByEmail(rec.email);
        emailMap.set(rec.email, userId);
        stats.existing += 1;
        await ensureUserRow(userId);
      } else if (/terminated|disabled|banned|invalid/i.test(msg)) {
        stats.skipped.push({ email: rec.email, reason: msg.slice(0, 120) });
        return;
      } else {
        throw created.error;
      }
    } else {
      userId = created.data.user.id;
      emailMap.set(rec.email, userId);
      stats.created += 1;
      await ensureUserRow(userId);
    }
  } else {
    stats.existing += 1;
  }

  if (dryRun) {
    stats.wouldUpdate += 1;
    return;
  }

  const { data: existing, error: exErr } = await db
    .from("users")
    .select(
      "birth_date, onboarded_at, last_seen_at, display_name, last_name, phone, city, country_code, getcourse_last_activity_at, membership_tier, trial_expires_at, crm_imported_at",
    )
    .eq("id", userId)
    .maybeSingle();
  if (exErr) throw exErr;

  const isLive = Boolean(existing?.onboarded_at || existing?.last_seen_at);
  const patch = {
    crm_imported_at: existing?.crm_imported_at || new Date().toISOString(),
  };

  // Activity: keep the fresher of DB vs import
  const prevAct = existing?.getcourse_last_activity_at
    ? Date.parse(existing.getcourse_last_activity_at)
    : -Infinity;
  const nextAct = rec.activityAt ? Date.parse(rec.activityAt) : -Infinity;
  const importFresherOrEqual = !existing?.getcourse_last_activity_at || nextAct >= prevAct;
  if (rec.activityAt && importFresherOrEqual) {
    patch.getcourse_last_activity_at = rec.activityAt;
  }

  // Profile fields (name/phone/geo) follow freshest GetCourse activity.
  // Live Harmonizer users: never overwrite name/city/country; phone only if fresher.
  if (isLive) {
    stats.liveTouched += 1;
    if (rec.phone && importFresherOrEqual) patch.phone = rec.phone;
  } else if (importFresherOrEqual) {
    if (rec.displayName) patch.display_name = rec.displayName;
    if (rec.lastName) patch.last_name = rec.lastName;
    if (rec.phone) patch.phone = rec.phone;
    if (rec.city) patch.city = rec.city;
    if (rec.countryCode) patch.country_code = rec.countryCode;
    if (rec.createdAt) patch.created_at = rec.createdAt;
    if (rec.birthDate && !existing?.birth_date) patch.birth_date = rec.birthDate;
    patch.trial_expires_at = null;
    patch.membership_tier = "free";
    patch.last_seen_at = null;
    patch.onboarded_at = null;
  } else if (!isLive) {
    // Stale import row: still keep CRM-only flags if somehow missing
    patch.trial_expires_at = null;
    if (!existing?.membership_tier || existing.membership_tier === "free") {
      patch.membership_tier = "free";
    }
    patch.last_seen_at = null;
    patch.onboarded_at = null;
  }

  // Courses from Экспорт_всех always applied below (even if this row is older).

  const { error: upErr } = await db.from("users").update(patch).eq("id", userId);
  if (upErr) throw upErr;

  if (withGroups && rec.groupIds.length) {
    const productIds = [
      ...new Set(
        rec.groupIds
          .map((g) => productByGroup.get(g))
          .filter(Boolean),
      ),
    ];
    const unknown = rec.groupIds.filter((g) => !productByGroup.has(g));
    stats.unknownGroups += unknown.length;
    if (productIds.length) {
      const { error: linkErr } = await db.from("user_crm_products").upsert(
        productIds.map((product_id) => ({ user_id: userId, product_id })),
        { onConflict: "user_id,product_id" },
      );
      if (linkErr) throw linkErr;
      stats.courseLinks += productIds.length;
    }
  }

  stats.updated += 1;
}

async function main() {
  const files = resolveFiles();
  console.log(dryRun ? "DRY-RUN" : "IMPORT", "files:", files.map((f) => f.split("/").pop()));

  const allowGroups = withGroups;
  let records = [];
  for (const f of files) {
    const rows = parseFileRows(f, { allowGroups });
    console.log("  ", f.split("/").pop(), "rows", rows.length);
    records = records.concat(rows);
  }
  const merged = mergeByEmail(records);
  console.log("unique emails", merged.length, "(from", records.length, "rows)");

  const allGroupIds = merged.flatMap((r) => r.groupIds);
  const productByGroup = allowGroups
    ? await loadGroupProductMap(allGroupIds)
    : new Map();

  const emailMap = dryRun ? new Map() : await loadEmailIdMap();
  console.log("auth users cached", emailMap.size);

  const stats = {
    created: 0,
    existing: 0,
    updated: 0,
    wouldCreate: 0,
    wouldUpdate: 0,
    liveTouched: 0,
    courseLinks: 0,
    unknownGroups: 0,
    errors: 0,
    needResolve: [],
    skipped: [],
  };

  let i = 0;
  for (const rec of merged) {
    i += 1;
    try {
      await importOne(rec, emailMap, productByGroup, stats);
      if (!dryRun) await sleep(60);
      if (i % 25 === 0 || i === merged.length) {
        const { needResolve, skipped, ...rest } = stats;
        console.log(`… ${i}/${merged.length}`, {
          ...rest,
          needResolve: needResolve.length,
          skipped: skipped.length,
        });
      }
    } catch (e) {
      stats.errors += 1;
      console.error("FAIL", rec.email, e?.message || e);
      await sleep(500);
    }
  }

  // Second pass: emails that already existed in Auth but weren't in the initial cache.
  if (!dryRun && stats.needResolve.length) {
    console.log("resolving", stats.needResolve.length, "already-registered emails…");
    const refreshed = await loadEmailIdMap();
    for (const [e, id] of refreshed) emailMap.set(e, id);
    const pending = merged.filter((r) => stats.needResolve.includes(r.email));
    stats.needResolve = [];
    for (const rec of pending) {
      try {
        await importOne(rec, emailMap, productByGroup, stats);
        await sleep(40);
      } catch (e) {
        stats.errors += 1;
        console.error("FAIL resolve", rec.email, e?.message || e);
      }
    }
  }

  if (!dryRun) {
    const { error: syncErr } = await db.rpc("sync_email_contacts_from_users");
    if (syncErr) console.warn("sync_email_contacts:", syncErr.message);
    else console.log("email_contacts synced");
  }

  console.log("DONE", {
    ...stats,
    needResolve: stats.needResolve.length,
    skipped: stats.skipped.length,
  });
  if (stats.skipped.length) {
    console.log(
      "SKIPPED sample",
      stats.skipped.slice(0, 20),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
