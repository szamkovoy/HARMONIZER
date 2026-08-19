import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import { getSupabaseAccessToken } from "@/services/supabase";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

const TIMEOUT_MS = 4_000;

let sessionCountry: string | null | undefined;

function normalizeCountry(raw: string | null | undefined): string {
  let code = (raw ?? "").trim().toUpperCase();
  if (code === "UK") code = "GB";
  return /^[A-Z]{2}$/.test(code) && code !== "XX" ? code : "";
}

/** Session cache so cabinet open and app_open share one round-trip. */
export function peekCachedIpCountry(): string | null | undefined {
  return sessionCountry;
}

export function clearCachedIpCountryForTests(): void {
  sessionCountry = undefined;
}

/**
 * ISO country of this device's public IP (VPN egress if a VPN is on).
 * Empty string when unknown. Cached for the JS session after the first attempt.
 */
export async function fetchIpCountry(): Promise<string> {
  if (sessionCountry !== undefined) return sessionCountry ?? "";

  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) {
    sessionCountry = "";
    return "";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${getCommunicatorApiBaseUrl()}/api/geo/ip-country`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      logRuntimeEvent("location:ip_country_http", { status: res.status }, "warn");
      sessionCountry = "";
      return "";
    }
    const data = (await res.json()) as { country?: string | null; source?: string };
    const country = normalizeCountry(data.country);
    sessionCountry = country;
    logRuntimeEvent("location:ip_country", { country: country || null, source: data.source ?? null });
    return country;
  } catch (error) {
    logRuntimeEvent(
      "location:ip_country_error",
      { message: error instanceof Error ? error.message : String(error) },
      "warn",
    );
    sessionCountry = "";
    return "";
  } finally {
    clearTimeout(timeoutId);
  }
}
