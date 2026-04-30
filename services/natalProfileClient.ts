import type { BirthData, NatalProfile } from "@/modules/astro-core";
import { getAstroNatalUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";

export interface CreateNatalProfileResult {
  natalChart?: unknown;
  profile: NatalProfile;
}

async function getAccessToken(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Нужна авторизация Supabase для сохранения натальной карты.");
  return token;
}

async function readError(res: Response): Promise<Error> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return new Error(typeof data?.error === "string" ? data.error : `HTTP ${res.status}`);
  }

  const text = await res.text().catch(() => res.statusText);
  if (text.includes("DEPLOYMENT_NOT_FOUND")) {
    return new Error(
      `Vercel deployment is not available for EXPO_PUBLIC_COMMUNICATOR_API_URL (${res.status}).`,
    );
  }
  return new Error(text.slice(0, 280) || `HTTP ${res.status}`);
}

function networkError(url: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Natal profile network error for ${url}: ${message}`);
}

export async function createNatalProfile(birthData: BirthData, signal?: AbortSignal): Promise<CreateNatalProfileResult> {
  const token = await getAccessToken();
  const url = getAstroNatalUrl();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ birthData }),
      signal,
    });
  } catch (error) {
    throw networkError(url, error);
  }

  if (!res.ok) throw await readError(res);
  return (await res.json()) as CreateNatalProfileResult;
}
