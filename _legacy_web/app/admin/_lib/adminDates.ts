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

/** YYYY-MM-DD для `<input type="date">` из ISO (UTC-срез; для локальной даты см. localDateInputValue). */
export function dateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

/** YYYY-MM-DD в локальной таймзоне браузера (сегодня, если value пуст). */
export function localDateInputValue(value?: string | Date | null): string {
  const d =
    value instanceof Date
      ? value
      : typeof value === "string" && value.trim()
        ? new Date(value)
        : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return formatLocalYmd(now);
  }
  return formatLocalYmd(d);
}

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Дата публикации из `<input type="date">`.
 * Сегодня → текущий момент (сразу видно в ленте); иначе — локальная полночь выбранного дня.
 */
export function publishedAtIsoFromDateInput(dateStr: string): string {
  const trimmed = dateStr.trim();
  const [y, m, d] = trimmed.split("-").map(Number);
  if (!y || !m || !d) return new Date().toISOString();
  const now = new Date();
  const isToday =
    now.getFullYear() === y && now.getMonth() === m - 1 && now.getDate() === d;
  if (isToday) return now.toISOString();
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
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

/**
 * Period line for users list: paid window first, else active trial «с … до …».
 * `startedAt` preferred over createdAt for «с».
 */
export function formatUserAccessPeriod(
  createdAt: string | null | undefined,
  membershipExpiresAt: string | null | undefined,
  membershipTier: string,
  trialExpiresAt: string | null | undefined,
  startedAt?: string | null | undefined,
): string | null {
  const now = Date.now();
  const fromIso = startedAt || createdAt;
  const paidActive =
    (membershipTier === "oracle" ||
      membershipTier === "practitioner" ||
      membershipTier === "master") &&
    (!membershipExpiresAt || new Date(membershipExpiresAt).getTime() > now);
  if (paidActive) {
    return formatUserTierPeriod(fromIso, membershipExpiresAt, membershipTier);
  }
  if (trialExpiresAt && new Date(trialExpiresAt).getTime() > now) {
    const from = fromIso ? formatAdminDate(fromIso) : null;
    const to = formatAdminDate(trialExpiresAt);
    if (from) return `с ${from} до ${to}`;
    return `до ${to}`;
  }
  return formatUserTierPeriod(fromIso, membershipExpiresAt, membershipTier);
}

/**
 * Compact period for Harmonizer card header: «с ДД.ММ.ГГГГ до ДД.ММ.ГГГГ, ЧЧ:ММ».
 * End uses membership/trial expiry (access truth), with time on the end bound.
 */
export function formatAccessPeriodHeader(
  createdAt: string | null | undefined,
  membershipExpiresAt: string | null | undefined,
  membershipTier: string,
  trialExpiresAt: string | null | undefined,
  startedAt?: string | null | undefined,
): string | null {
  const now = Date.now();
  const fromIso = startedAt || createdAt;
  const from = fromIso ? formatAdminDate(fromIso) : null;
  const paidActive =
    (membershipTier === "oracle" ||
      membershipTier === "practitioner" ||
      membershipTier === "master") &&
    (!membershipExpiresAt || new Date(membershipExpiresAt).getTime() > now);
  if (paidActive) {
    if (!membershipExpiresAt) return from ? `с ${from}` : null;
    const to = formatAdminDateTime(membershipExpiresAt);
    return from ? `с ${from} до ${to}` : `до ${to}`;
  }
  if (trialExpiresAt && new Date(trialExpiresAt).getTime() > now) {
    const to = formatAdminDateTime(trialExpiresAt);
    return from ? `с ${from} до ${to}` : `до ${to}`;
  }
  if (membershipExpiresAt) {
    const to = formatAdminDateTime(membershipExpiresAt);
    return from ? `с ${from} до ${to}` : `до ${to}`;
  }
  return from ? `с ${from}` : null;
}
