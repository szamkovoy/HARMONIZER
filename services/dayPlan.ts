import { getDayUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";
import { wrapConnectivityFailure } from "@/services/userFacingErrors";
import { withTransientNetworkRetry } from "@/services/withTransientNetworkRetry";
import type { PracticeSummary } from "@/modules/practices/core/types";

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

async function getAccessToken(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Нужна авторизация Supabase для загрузки дня.");
  return token;
}

async function fetchDayJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  return withTransientNetworkRetry(async () => {
    const accessToken = await getAccessToken();
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      throw wrapConnectivityFailure(error, "day-plan");
    }
    if (!res.ok) {
      const message = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(message || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  });
}

export async function loadDayPlan(): Promise<DayPlan> {
  return fetchDayJson<DayPlan>(getDayUrl());
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

export async function savePendingDayPractice(localDate: string, practice: PracticeSummary): Promise<void> {
  await fetchDayJson<{ ok: boolean; id: string | null }>(getDayUrl(), {
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
}
