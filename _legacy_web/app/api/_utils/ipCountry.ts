/**
 * Country from the request IP (Vercel edge headers, then a public IP lookup).
 * Used when the app has no GPS country for billing / cabinet gateway routing.
 */

const RESERVED_COUNTRY_CODES = new Set(["XX", "A1", "A2", "O1", "T1", "AP", "EU"]);

const IPV4_PRIVATE =
  /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/;

export type IpCountrySource = "vercel" | "ip_lookup" | "none";

export type IpCountryResult = {
  country: string;
  source: IpCountrySource;
};

/** ISO-3166 alpha-2; UK → GB; anonymous/unknown codes dropped. */
export function normalizeIsoCountryCode(raw: string | null | undefined): string {
  let code = (raw ?? "").trim().toUpperCase();
  if (code === "UK") code = "GB";
  if (!/^[A-Z]{2}$/.test(code)) return "";
  if (RESERVED_COUNTRY_CODES.has(code)) return "";
  return code;
}

export function isPublicIp(ip: string): boolean {
  const trimmed = ip.trim();
  if (!trimmed) return false;
  if (trimmed === "::1" || trimmed.startsWith("fe80:") || trimmed.startsWith("fc") || trimmed.startsWith("fd")) {
    return false;
  }
  if (IPV4_PRIVATE.test(trimmed)) return false;
  return true;
}

/** Left-most non-private hop in X-Forwarded-For / X-Real-IP. */
export function clientIpFromHeaders(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for") ?? headers.get("X-Forwarded-For");
  if (forwarded) {
    for (const part of forwarded.split(",")) {
      const ip = part.trim().replace(/^\[(.+)\]$/, "$1");
      if (isPublicIp(ip)) return ip;
    }
  }
  const real = (headers.get("x-real-ip") ?? headers.get("X-Real-IP") ?? "").trim();
  if (real && isPublicIp(real)) return real;
  return null;
}

export function countryFromVercelHeaders(headers: Headers): string {
  return normalizeIsoCountryCode(
    headers.get("x-vercel-ip-country") ?? headers.get("X-Vercel-IP-Country"),
  );
}

type IpLookupFn = (ip: string) => Promise<string>;

const IPWHO_TIMEOUT_MS = 2_500;

export async function lookupCountryByIp(ip: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!isPublicIp(ip)) return "";
  try {
    const url = `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(IPWHO_TIMEOUT_MS) });
    if (!res.ok) return "";
    const data = (await res.json()) as { success?: boolean; country_code?: string };
    if (data.success === false) return "";
    return normalizeIsoCountryCode(data.country_code);
  } catch {
    return "";
  }
}

export async function resolveIpCountry(
  headers: Headers,
  lookup: IpLookupFn = lookupCountryByIp,
): Promise<IpCountryResult> {
  const vercel = countryFromVercelHeaders(headers);
  if (vercel) return { country: vercel, source: "vercel" };

  const ip = clientIpFromHeaders(headers);
  if (!ip) return { country: "", source: "none" };

  const lookedUp = await lookup(ip);
  if (lookedUp) return { country: lookedUp, source: "ip_lookup" };
  return { country: "", source: "none" };
}
