/** Единый формат дат в админке: ДД.ММ.ГГГГ и ДД.ММ.ГГГГ ЧЧ:ММ. */
const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatAdminDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return dateFmt.format(d);
}

export function formatAdminDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return dateTimeFmt.format(d);
}

/** YYYY-MM-DD для `<input type="date">` из ISO. */
export function dateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

/**
 * Дата из date-input + текущее время браузера (не 23:59).
 * Пустая строка → null (бессрочно).
 */
export function expiryIsoFromDateInput(dateStr: string): string | null {
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  const now = new Date();
  const [y, m, d] = trimmed.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()).toISOString();
}

/** «с 23.04.2026 до 08.08.2026» или только регистрация / бессрочно. */
export function formatUserTierPeriod(
  createdAt: string | null | undefined,
  expiresAt: string | null | undefined,
  tier: string,
): string | null {
  const from = createdAt ? formatAdminDate(createdAt) : null;
  if (tier === "free" || !expiresAt) {
    return from ? `с ${from}` : null;
  }
  const to = formatAdminDate(expiresAt);
  if (from) return `с ${from} до ${to}`;
  return `до ${to}`;
}
