import { getProfileLifeMatrixUrl, getProfilePracticeByChakraUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";

export type LifeMatrixReport = {
  activeDaysCount: number;
  matrixReady: boolean;
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
  const accessToken = await getAccessToken();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    const message = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(message || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function loadLifeMatrixReport(): Promise<LifeMatrixReport> {
  return fetchJson<LifeMatrixReport>(getProfileLifeMatrixUrl());
}

export async function loadPracticeByChakraReport(days: number): Promise<PracticeByChakraReport> {
  return fetchJson<PracticeByChakraReport>(`${getProfilePracticeByChakraUrl()}?days=${days}`);
}
