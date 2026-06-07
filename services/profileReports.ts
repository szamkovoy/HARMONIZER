import { getProfileLifeMatrixUrl, getProfilePracticeByChakraUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";
import { wrapConnectivityFailure } from "@/services/userFacingErrors";
import { withTransientNetworkRetry } from "@/services/withTransientNetworkRetry";

export type LifeMatrixReport = {
  activeDaysCount: number;
  summarizedEventsCount: number;
  firstSummaryLocalDate: string | null;
  matrixReady: boolean;
  trendReady: boolean;
  chakras: Array<{ chakra: number; label: string; shortLabel: string; color: string }>;
  spheres: Array<{ id: number; slug: string; title: string }>;
  rawMatrix: number[][];
  visualMatrix: number[][];
  calendarTrend: Array<{ localDate: string; rangeMetric: number }>;
};

export type PracticeByChakraReport = {
  intervalDays: number;
  totalDurationSec: number;
  chakraStats: Array<{ chakra: number; label: string; shortLabel: string; color: string; durationSec: number }>;
};

async function getAccessToken(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Нужна авторизация Supabase для загрузки отчётов.");
  return token;
}

async function fetchJson<T>(url: string): Promise<T> {
  return withTransientNetworkRetry(async () => {
    const accessToken = await getAccessToken();
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch (error) {
      throw wrapConnectivityFailure(error, "profile-reports");
    }
    if (!res.ok) {
      const message = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(message || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  });
}

export async function loadLifeMatrixReport(): Promise<LifeMatrixReport> {
  return fetchJson<LifeMatrixReport>(getProfileLifeMatrixUrl());
}

export async function loadPracticeByChakraReport(days: number): Promise<PracticeByChakraReport> {
  return fetchJson<PracticeByChakraReport>(`${getProfilePracticeByChakraUrl()}?days=${days}`);
}
