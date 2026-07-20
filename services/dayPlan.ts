import { getDayUrl } from "@/services/communicatorConfig";
import { getSupabaseAccessSession } from "@/services/supabase";
import { wrapConnectivityFailure } from "@/services/userFacingErrors";
import { withTransientNetworkRetry } from "@/services/withTransientNetworkRetry";
import type { PracticeSummary } from "@/modules/practices/core/types";
import { getResponseLocale } from "@/modules/i18n";
import { saveCachedDayPlan } from "@/services/dayPlanCache";

export type DayAction = {
  id: string;
  localDate: string;
  title: string;
  recommendation: string | null;
  explicitTimeText: string | null;
  displayOrder: number;
  status: string;
  summarizedAt: string | null;
  outcomeText: string | null;
  cells: Array<{ sphere: number; weight: number }>;
};

export type DaySphereStat = {
  id: number;
  title: string;
  value: number;
  radius: number;
};

export type DayPracticeLog = {
  id: string;
  localDate: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
};

export type DaySection = {
  localDate: string;
  dateLabelKind: "today" | "yesterday" | "date";
  actions: DayAction[];
  sphereStats: DaySphereStat[];
  sphereHint: string | null;
  practices: DayPracticeLog[];
};

export type DayPracticeOffer = {
  id: string;
  practice_kind: "meditation" | "breath" | "yoga";
  practice_id: string | null;
  practice_slug: string;
  title: string;
  duration_sec: number | null;
  launch: PracticeSummary["launch"];
  practice_summary: PracticeSummary;
  status: string;
  created_at: string;
};

export type DayPlan = {
  mode: "empty_today" | "overdue_summary" | "current_day";
  currentLocalDate: string;
  timezone: string;
  forecast: Record<string, unknown> | null;
  dayRecommendation: string | null;
  hasOverdueSummary: boolean;
  canSummarizeCurrentDay: boolean;
  summaryTargetLocalDate: string | null;
  sections: DaySection[];
  pendingPractice: DayPracticeOffer | null;
};

const DAY_PLAN_FETCH_TIMEOUT_MS = 45_000;

async function fetchDayJson<T>(
  url: string,
  init: RequestInit = {},
  options?: { timeoutMs?: number },
): Promise<T> {
  return withTransientNetworkRetry(async () => {
    const session = await getSupabaseAccessSession();
    const accessToken = session.access_token;
    const timeoutMs = options?.timeoutMs ?? DAY_PLAN_FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("DAY_PLAN_TIMEOUT");
      }
      throw wrapConnectivityFailure(error, "day-plan");
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) {
      const message = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(message || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  });
}

export async function loadDayPlan(): Promise<DayPlan> {
  const plan = await fetchDayJson<DayPlan>(getDayUrl());
  void saveCachedDayPlan({
    userId: (await getSupabaseAccessSession()).user.id,
    locale: getResponseLocale(),
    plan,
  });
  return plan;
}

export async function renameDayAction(eventId: string, title: string): Promise<void> {
  await fetchDayJson<{ ok: boolean }>(getDayUrl(), {
    method: "PATCH",
    body: JSON.stringify({ action: "rename_event", eventId, title }),
  });
}

export async function deleteDayAction(eventId: string): Promise<void> {
  await fetchDayJson<{ ok: boolean }>(getDayUrl(), {
    method: "PATCH",
    body: JSON.stringify({ action: "delete_event", eventId }),
  });
}

export async function cancelPendingDayPractice(offerId: string): Promise<void> {
  await fetchDayJson<{ ok: boolean }>(getDayUrl(), {
    method: "PATCH",
    body: JSON.stringify({ action: "cancel_practice_offer", offerId }),
  });
}

export async function savePendingDayPractice(
  localDate: string,
  practice: PracticeSummary,
): Promise<{ id: string | null }> {
  const result = await fetchDayJson<{ ok: boolean; id: string | null }>(getDayUrl(), {
    method: "POST",
    body: JSON.stringify({
      localDate,
      practice: {
        id: practice.id,
        slug: practice.slug,
        kind: practice.kind,
        title: practice.title,
        defaultDurationSec: practice.defaultDurationSec ?? null,
        launch: practice.launch,
        summary: practice,
      },
    }),
  });
  return { id: result.id ?? null };
}
