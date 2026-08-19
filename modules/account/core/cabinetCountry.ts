export type CabinetCountrySource = "profile" | "ip" | "none";

function normalizeCountry(raw: string | null | undefined): string {
  const code = (raw ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

/** GPS profile country wins; IP only if that field is empty. Never mix the two. */
export function pickCabinetCountry(
  profileCountry: string | null | undefined,
  ipCountry: string | null | undefined,
): { country: string; source: CabinetCountrySource } {
  const profile = normalizeCountry(profileCountry);
  if (profile) return { country: profile, source: "profile" };
  const ip = normalizeCountry(ipCountry);
  if (ip) return { country: ip, source: "ip" };
  return { country: "", source: "none" };
}

export function currencyForCountry(isoCountryCode: string | null | undefined): "RUB" | "USD" | "EUR" {
  const code = isoCountryCode?.trim().toUpperCase();
  if (code === "RU") return "RUB";
  if (code === "US") return "USD";
  return "EUR";
}
