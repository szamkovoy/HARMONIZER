/**
 * Ключ scope для dayContentCache — общий для Home и онбординг-прогрева.
 *
 * Postgres `time` при чтении отдаёт `HH:MM:SS` (напр. `12:45:00`), а мастер
 * вводит `HH:MM`. Канон ключа — всегда `HH:MM:SS`, иначе после смены формата
 * trial/paid Home теряет SecureStore-кэш и уходит в cold API с таймаутом ~25s
 * (регресс 2026-07-24 на sezam777).
 */
export function normalizeBirthTimeForScope(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return s;
  const hh = m[1].padStart(2, "0");
  const mm = m[2];
  const ss = (m[3] ?? "00").padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Короткий вариант HH:MM — для чтения кэша, записанного ошибочной нормализацией. */
export function normalizeBirthTimeShortForScope(raw: string | null | undefined): string {
  const full = normalizeBirthTimeForScope(raw);
  const m = /^(\d{2}):(\d{2}):\d{2}$/.exec(full);
  return m ? `${m[1]}:${m[2]}` : full;
}

export function dayContentNatalScopeKey(parts: {
  birth_date?: string | null;
  birth_time?: string | null;
  birth_place?: unknown;
}): string {
  const place =
    typeof parts.birth_place === "string"
      ? parts.birth_place
      : JSON.stringify(parts.birth_place ?? null);
  const raw = [
    String(parts.birth_date ?? "").trim(),
    normalizeBirthTimeForScope(parts.birth_time),
    place,
  ].join("|");
  return raw.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "default";
}

/** Канон + короткий HH:MM (на случай кэша от краткой нормализации). */
export function dayContentNatalScopeKeyCandidates(parts: {
  birth_date?: string | null;
  birth_time?: string | null;
  birth_place?: unknown;
}): string[] {
  const place =
    typeof parts.birth_place === "string"
      ? parts.birth_place
      : JSON.stringify(parts.birth_place ?? null);
  const date = String(parts.birth_date ?? "").trim();
  const make = (time: string) =>
    [date, time, place].join("|").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "default";
  const canonical = make(normalizeBirthTimeForScope(parts.birth_time));
  const short = make(normalizeBirthTimeShortForScope(parts.birth_time));
  return canonical === short ? [canonical] : [canonical, short];
}

export function dayContentLocaleScopeKey(
  accessMode: "free" | "premium",
  natalScope: string,
  locale: string,
): string {
  const base = accessMode === "free" ? "global" : natalScope;
  return `${base}:${locale}`;
}
