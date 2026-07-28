import type { SupabaseClient } from "@supabase/supabase-js";

import { emailsByUserId } from "./authEmails";

export type AdminLedgerRow = {
  id: string;
  kind: "grant" | "gateway";
  editable: boolean;
  user_id: string | null;
  amount: number;
  currency: string;
  tier: string;
  paid_until: string | null;
  source: string;
  provider: string;
  comment: string | null;
  created_at: string;
  edited_at: string | null;
  display_name?: string;
  email?: string;
  contract_id?: string | null;
};

type Options = {
  userId?: string;
  limit?: number;
};

/**
 * Unified admin ledger: manual grants (editable) + gateway charges (Lava/YuKassa, read-only).
 * Amounts are gross in original payment currency.
 */
export async function loadAdminPaymentLedger(
  db: SupabaseClient,
  options: Options = {},
): Promise<AdminLedgerRow[]> {
  const limit = Math.min(options.limit ?? 200, 500);
  const userId = options.userId;

  let grantsQuery = db
    .from("payments")
    .select(
      "id, user_id, amount, currency, tier, paid_until, source, comment, created_at, edited_at, buyer_email, users(display_name)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (userId) grantsQuery = grantsQuery.eq("user_id", userId);

  let contractsQuery = db
    .from("payment_contracts")
    .select(
      "id, contract_id, user_id, amount, currency, tier, status, provider, product_kind, current_period_end, buyer_email, created_at, users(display_name)",
    )
    .in("status", ["active", "cancelled"])
    .not("amount", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (userId) contractsQuery = contractsQuery.eq("user_id", userId);

  const [grantsRes, contractsRes] = await Promise.all([grantsQuery, contractsQuery]);
  if (grantsRes.error) throw grantsRes.error;
  if (contractsRes.error) throw contractsRes.error;

  const userIds = [
    ...new Set(
      [...(grantsRes.data ?? []), ...(contractsRes.data ?? [])]
        .map((r) => r.user_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const emails = await emailsByUserId(db, userIds);

  const grantRows: AdminLedgerRow[] = (grantsRes.data ?? []).map((p) => {
    const user = p.users as { display_name?: string | null } | null;
    const email =
      (p.user_id ? emails.get(p.user_id as string) : null) || (p.buyer_email as string) || "—";
    return {
      id: p.id as string,
      kind: "grant",
      editable: true,
      user_id: (p.user_id as string | null) ?? null,
      amount: Number(p.amount) || 0,
      currency: (p.currency as string) || "RUB",
      tier: p.tier as string,
      paid_until: (p.paid_until as string | null) ?? null,
      source: (p.source as string) || "manual",
      provider: "manual",
      comment: (p.comment as string | null) ?? null,
      created_at: p.created_at as string,
      edited_at: (p.edited_at as string | null) ?? null,
      display_name: ledgerDisplayName(user?.display_name, email === "—" ? null : email),
      email,
    };
  });

  const gatewayRows: AdminLedgerRow[] = (contractsRes.data ?? []).map((c) => {
    const user = c.users as { display_name?: string | null } | null;
    const provider = normalizeGatewayProvider(c.provider as string | null);
    const email =
      (c.user_id ? emails.get(c.user_id as string) : null) || (c.buyer_email as string) || "—";
    return {
      id: `gw:${c.contract_id}`,
      kind: "gateway",
      editable: false,
      user_id: (c.user_id as string | null) ?? null,
      amount: Number(c.amount) || 0,
      currency: (c.currency as string) || "RUB",
      tier: c.tier as string,
      paid_until: (c.current_period_end as string | null) ?? null,
      source: provider,
      provider,
      comment: null,
      created_at: c.created_at as string,
      edited_at: null,
      display_name: ledgerDisplayName(user?.display_name, email === "—" ? null : email),
      email,
      contract_id: c.contract_id as string,
    };
  });

  return [...grantRows, ...gatewayRows]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, limit);
}

export function normalizeGatewayProvider(raw: string | null | undefined): string {
  const p = (raw ?? "lavatop").toLowerCase();
  if (p === "yandex" || p === "yookassa" || p === "yukassa" || p === "yandex_kassa") return "yookassa";
  if (p === "lavatop" || p === "lava") return "lavatop";
  return p;
}

/** Имя для списка: display_name пользователя, иначе локальная часть email. */
export function ledgerDisplayName(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  const name = displayName?.trim();
  if (name) return name;
  const local = email?.split("@")[0]?.trim();
  if (local) return local;
  return "Без имени";
}
