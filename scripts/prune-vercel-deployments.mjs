/**
 * Keep the newest N Vercel deployments for harmonizer and delete the rest.
 * Never deletes the newest production deployment, even if it falls outside N.
 *
 *   VERCEL_TOKEN=... node scripts/prune-vercel-deployments.mjs
 *   VERCEL_PRUNE_DRY_RUN=1 node scripts/prune-vercel-deployments.mjs
 *
 * Defaults: project prj_1EjXoTHPX6b0ipmJJNaLNsjl0ISb, team szamkovoys-projects, keep 10.
 */

const KEEP = Number(process.env.VERCEL_KEEP_DEPLOYMENTS || 10);
const DRY = process.env.VERCEL_PRUNE_DRY_RUN === "1";
const TOKEN = process.env.VERCEL_TOKEN?.trim();
const PROJECT_ID = process.env.VERCEL_PROJECT_ID?.trim() || "prj_1EjXoTHPX6b0ipmJJNaLNsjl0ISb";
const TEAM_ID = process.env.VERCEL_ORG_ID?.trim() || "team_ANo4cxAoQvQvmmcINhhEphct";

if (!TOKEN) {
  console.error("VERCEL_TOKEN is required");
  process.exit(1);
}
if (!Number.isInteger(KEEP) || KEEP < 5 || KEEP > 20) {
  console.error("VERCEL_KEEP_DEPLOYMENTS must be an integer from 5 to 20");
  process.exit(1);
}

async function api(path, { method = "GET" } = {}) {
  const url = new URL(`https://api.vercel.com${path}`);
  url.searchParams.set("teamId", TEAM_ID);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function listDeployments() {
  const all = [];
  let until;
  for (;;) {
    const qs = new URLSearchParams({ projectId: PROJECT_ID, limit: "100" });
    if (until) qs.set("until", String(until));
    const page = await api(`/v6/deployments?${qs}`);
    const batch = page.deployments ?? [];
    all.push(...batch);
    if (batch.length < 100) break;
    const oldest = batch[batch.length - 1]?.created;
    if (!oldest || oldest === until) break;
    until = oldest;
  }
  return all;
}

const deployments = await listDeployments();
deployments.sort((a, b) => b.created - a.created);

const newestProduction = deployments.find(
  (item) => item.target === "production" && item.readyState === "READY",
);

const keep = new Set(deployments.slice(0, KEEP).map((item) => item.uid));
if (newestProduction) keep.add(newestProduction.uid);

const remove = deployments.filter((item) => {
  if (keep.has(item.uid)) return false;
  if (item.readyState === "BUILDING" || item.readyState === "QUEUED" || item.readyState === "INITIALIZING") {
    return false;
  }
  return true;
});

console.log(
  `${DRY ? "dry-run " : ""}deployments=${deployments.length} keep=${keep.size} delete=${remove.length}`,
);
for (const item of remove) {
  const when = new Date(item.created).toISOString();
  console.log(`${DRY ? "would delete" : "delete"} ${item.uid} ${item.target ?? "-"} ${item.readyState} ${when}`);
  if (!DRY) {
    await api(`/v13/deployments/${item.uid}`, { method: "DELETE" });
  }
}
