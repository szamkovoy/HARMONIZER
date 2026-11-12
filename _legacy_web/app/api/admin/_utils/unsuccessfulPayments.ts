/**
 * Вкладка «Неуспешные»: отказ, закрытое продление, брошенный pending.
 * Статус abandoned не вводится — «брошенные» это pending старше 30 минут.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const PENDING_STALE_AFTER_MS = 30 * 60 * 1000;
const LIMIT = 100;

const SELECT =
  "contract_id,user_id,buyer_email,tier,product_kind,product_ref,amount,currency,provider,failure_reason,created_at,updated_at,status";

export type UnsuccessfulRow = {
  contractId: string;
  userId: string | null;
  email: string | null;
  tier: string;
  productKind: string | null;
  productRef: string | null;
  amount: number | null;
  currency: string | null;
  provider: string | null;
  reason: string | null;
  at: string;
};

export function isLapsedFailureReason(reason: string | null | undefined): boolean {
  const value = (reason ?? "").trim().toLowerCase();
  return value.startsWith("renewal") || value.startsWith("lapsed");
}

export function classifyUnsuccessful(
  row: { status: string; failure_reason?: string | null; created_at: string },
  now: Date,
): "failed" | "lapsed" | "pending" | null {
  if (row.status === "failed") return "failed";
  if (row.status === "cancelled" && isLapsedFailureReason(row.failure_reason)) return "lapsed";
  if (row.status === "pending") {
    const created = new Date(row.created_at).getTime();
    if (Number.isFinite(created) && now.getTime() - created > PENDING_STALE_AFTER_MS) return "pending";
  }
  return null;
}

type DbRow = {
  contract_id: string;
  user_id: string | null;
  buyer_email: string | null;
  tier: string;
  product_kind: string | null;
  product_ref: string | null;
  amount: number | null;
  currency: string | null;
  provider: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string | null;
};

function mapRow(row: DbRow, at: string): UnsuccessfulRow {
  return {
    contractId: row.contract_id,
    userId: row.user_id,
    email: row.buyer_email,
    tier: row.tier,
    productKind: row.product_kind,
    productRef: row.product_ref,
    amount: row.amount,
    currency: row.currency,
    provider: row.provider,
    reason: row.failure_reason,
    at,
  };
}

async function take(result: { data: unknown; error: { message: string } | null }): Promise<DbRow[]> {
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as DbRow[];
}

export async function loadUnsuccessfulPayments(
  db: SupabaseClient,
  now = new Date(),
): Promise<{ failed: UnsuccessfulRow[]; lapsed: UnsuccessfulRow[]; pending: UnsuccessfulRow[] }> {
  const cutoff = new Date(now.getTime() - PENDING_STALE_AFTER_MS).toISOString();
  const [failed, renewal, lapsed, pending] = await Promise.all([
    take(
      await db.from("payment_contracts").select(SELECT).eq("status", "failed").order("updated_at", { ascending: false }).limit(LIMIT),
    ),
    take(
      await db
        .from("payment_contracts")
        .select(SELECT)
        .eq("status", "cancelled")
        .ilike("failure_reason", "renewal%")
        .order("updated_at", { ascending: false })
        .limit(LIMIT),
    ),
    take(
      await db
        .from("payment_contracts")
        .select(SELECT)
        .eq("status", "cancelled")
        .ilike("failure_reason", "lapsed%")
        .order("updated_at", { ascending: false })
        .limit(LIMIT),
    ),
    take(
      await db
        .from("payment_contracts")
        .select(SELECT)
        .eq("status", "pending")
        .lt("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(LIMIT),
    ),
  ]);

  const lapsedRows = [...renewal, ...lapsed]
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, LIMIT);

  return {
    failed: failed.map((row) => mapRow(row, row.updated_at ?? row.created_at)),
    lapsed: lapsedRows.map((row) => mapRow(row, row.updated_at ?? row.created_at)),
    pending: pending.map((row) => mapRow(row, row.created_at)),
  };
}
