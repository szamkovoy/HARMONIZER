import {
  aggregateSettlementNets,
  parseDisplayCurrency,
  type FxCurrency,
} from "../../account/fx";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { normalizeGatewayProvider } from "../_utils/paymentLedger";

export const runtime = "nodejs";

const TOKEN_ALERT_THRESHOLD_24H = 80_000;
const LLM_ERROR_ALERT_THRESHOLD_24H = 15;

type RangeDays = 7 | 30 | 90 | 0;
type Grain = "day" | "week";

function parseRange(raw: string | null): RangeDays {
  if (raw === "all" || raw === "0") return 0;
  const n = Number(raw ?? 7);
  if (n === 30 || n === 90) return n;
  return 7;
}

function parseGrain(raw: string | null, rangeDays: RangeDays): Grain {
  if (rangeDays === 0) return "week";
  return raw === "week" ? "week" : "day";
}

type PulseRow = {
  generated_at: string;
  range_days: number;
  range_all_time?: boolean;
  grain: string;
  kpi: {
    users_total: number;
    reg_period: number;
    reg_prev_period: number;
    active_24h: number;
    active_7d: number;
    active_period: number;
    access_now: { navigator: number; trial: number; oracle: number; master: number };
    cohort: { reg_total: number; bought_oracle: number; bought_master: number };
    renew_m2: {
      oracle_pct: number | null;
      master_pct: number | null;
      oracle_eligible: number;
      master_eligible: number;
    };
    revenue_lava: Array<{ currency: string; sum: number; count: number }>;
    revenue_lava_net?: { currency: string; sum: number; count: number };
    revenue_yookassa_net?: { currency: string; sum: number; count: number };
    revenue_gateways_net?: { currency: string; sum: number; count: number };
    grants_manual: { sum: number; count: number };
  };
  display_currency?: FxCurrency;
  funnels?: { oracle: number[]; master: number[] };
  series: {
    registrations: Array<{ bucket: string; count: number }>;
    active_users: Array<{ bucket: string; count: number }>;
    revenue: Array<{ bucket: string; currency: string; sum: number; count: number }>;
    revenue_yookassa?: Array<{ bucket: string; currency: string; sum: number; count: number }>;
    tokens?: Array<{ bucket: string; tokens: number }>;
  };
  revenue_by_tier: Array<{ tier: string; sum: number; count: number }>;
  revenue_by_tier_yookassa?: Array<{ tier: string; sum: number; count: number }>;
  load: {
    llm_24h: {
      dialog_turns?: number;
      llm_errors?: number;
      llm_timeouts?: number;
      prompt_tokens?: number;
      avg_latency_ms?: number | null;
      p95_latency_ms?: number | null;
    };
    llm_period: {
      dialog_turns?: number;
      llm_errors?: number;
      llm_timeouts?: number;
      prompt_tokens?: number;
      avg_latency_ms?: number | null;
      p95_latency_ms?: number | null;
    };
    top_users_tokens_24h: Array<{
      user_id: string;
      display_name: string | null;
      tokens: number;
    }>;
  };
  geo: { by_country: Array<{ code: string; count: number }> };
};

/** Пульс проекта: быстрые KPI + серии. Агрегаты в RPC admin_dashboard_pulse. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const rangeDays = parseRange(url.searchParams.get("range") ?? url.searchParams.get("days"));
    const grain = parseGrain(url.searchParams.get("grain"), rangeDays);
    const displayCurrency = parseDisplayCurrency(url.searchParams.get("currency"));
    const db = createServiceSupabase();

    const { data, error } = await db.rpc("admin_dashboard_pulse", {
      p_days: rangeDays,
      p_grain: grain,
    });
    if (error) throw error;

    const pulse = data as PulseRow;

    // Net revenue (after acquiring fee + FX) from payment_settlements (Lava.top + ЮКасса).
    const sinceIso =
      rangeDays === 0
        ? "1970-01-01T00:00:00.000Z"
        : new Date(
            Date.now() - Math.max(1, pulse.range_days || rangeDays || 30) * 24 * 60 * 60 * 1000,
          ).toISOString();
    let settlementsQuery = db
      .from("payment_settlements")
      .select("paid_at, provider, net_amount_rub, net_amount_eur, net_amount_usd, contract_id");
    if (rangeDays !== 0) {
      settlementsQuery = settlementsQuery.gte("paid_at", sinceIso);
    }
    const settlementsRes = await settlementsQuery;
    if (settlementsRes.error) throw settlementsRes.error;

    const rawSettlements = settlementsRes.data ?? [];
    const contractIds = [...new Set(rawSettlements.map((r) => r.contract_id as string))];
    const tierByContract = new Map<string, string>();
    if (contractIds.length > 0) {
      const tiersRes = await db
        .from("payment_contracts")
        .select("contract_id, tier")
        .in("contract_id", contractIds);
      if (tiersRes.error) throw tiersRes.error;
      for (const row of tiersRes.data ?? []) {
        tierByContract.set(row.contract_id as string, row.tier as string);
      }
    }

    const settlementRows = rawSettlements.map((row) => ({
      paid_at: row.paid_at as string,
      provider: normalizeGatewayProvider(row.provider as string),
      net_amount_rub: row.net_amount_rub as number,
      net_amount_eur: row.net_amount_eur as number,
      net_amount_usd: row.net_amount_usd as number,
      tier: tierByContract.get(row.contract_id as string) ?? null,
    }));
    const lavaRows = settlementRows.filter((r) => r.provider === "lavatop");
    const yukassaRows = settlementRows.filter((r) => r.provider === "yookassa");
    const gatewayRows = [...lavaRows, ...yukassaRows];

    const lavaAgg = aggregateSettlementNets(lavaRows, displayCurrency, grain);
    const yukassaAgg = aggregateSettlementNets(yukassaRows, displayCurrency, grain);
    const gatewaysAgg = aggregateSettlementNets(gatewayRows, displayCurrency, grain);

    pulse.kpi.revenue_lava = [
      { currency: displayCurrency, sum: lavaAgg.total, count: lavaAgg.count },
    ];
    pulse.kpi.revenue_lava_net = {
      currency: displayCurrency,
      sum: lavaAgg.total,
      count: lavaAgg.count,
    };
    pulse.kpi.revenue_yookassa_net = {
      currency: displayCurrency,
      sum: yukassaAgg.total,
      count: yukassaAgg.count,
    };
    pulse.kpi.revenue_gateways_net = {
      currency: displayCurrency,
      sum: gatewaysAgg.total,
      count: gatewaysAgg.count,
    };
    pulse.series.revenue = lavaAgg.by_day;
    pulse.series.revenue_yookassa = yukassaAgg.by_day;
    pulse.revenue_by_tier = lavaAgg.by_tier;
    pulse.revenue_by_tier_yookassa = yukassaAgg.by_tier;
    pulse.display_currency = displayCurrency;
    const alerts: Array<{ id: string; severity: "warn" | "critical"; title: string; detail: string }> = [];

    const llmErrors24 =
      (pulse.load?.llm_24h?.llm_errors ?? 0) + (pulse.load?.llm_24h?.llm_timeouts ?? 0);
    if (llmErrors24 >= LLM_ERROR_ALERT_THRESHOLD_24H) {
      alerts.push({
        id: "llm_errors_24h",
        severity: "warn",
        title: "Всплеск ошибок LLM за 24 часа",
        detail: `${llmErrors24} ошибок/таймаутов (порог ${LLM_ERROR_ALERT_THRESHOLD_24H})`,
      });
    }

    const heavyUsers = (pulse.load?.top_users_tokens_24h ?? []).filter(
      (u) => Number(u.tokens) >= TOKEN_ALERT_THRESHOLD_24H,
    );
    for (const u of heavyUsers.slice(0, 3)) {
      alerts.push({
        id: `tokens_${u.user_id}`,
        severity: "critical",
        title: "Высокий расход токенов за 24 часа",
        detail: `${u.display_name?.trim() || u.user_id.slice(0, 8)} · ~${Math.round(Number(u.tokens))} ток.`,
      });
    }

    const regPeriod = pulse.kpi?.reg_period ?? 0;
    const regPrev = pulse.kpi?.reg_prev_period ?? 0;
    if (regPrev >= 3 && regPeriod < regPrev * 0.5) {
      alerts.push({
        id: "reg_drop",
        severity: "warn",
        title: "Падение регистраций к прошлому окну",
        detail: `${regPeriod} vs ${regPrev} за предыдущие ${pulse.range_days} дн.`,
      });
    }

    const geoCount = pulse.geo?.by_country?.length ?? 0;
    const topTokensReady =
      (pulse.load?.top_users_tokens_24h?.length ?? 0) > 0
      || Number(pulse.load?.llm_period?.prompt_tokens ?? 0) > 0
      || Number(pulse.load?.llm_period?.dialog_turns ?? 0) > 0;

    const partial: string[] = [];
    if (geoCount === 0) partial.push("geo");
    if (!topTokensReady) partial.push("top_tokens_sparse");

    return json({
      ...pulse,
      display_currency: displayCurrency,
      alerts,
      meta: {
        partial,
        thresholds: {
          token_user_24h: TOKEN_ALERT_THRESHOLD_24H,
          llm_errors_24h: LLM_ERROR_ALERT_THRESHOLD_24H,
        },
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
