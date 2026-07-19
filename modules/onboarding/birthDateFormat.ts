/**
 * Общие хелперы форматирования полей рождения (дата + время).
 *
 * Канон ввода — тот же, что в мастере регистрации (шаг 2): дата «DD-MM-YYYY»
 * с автоматическими дефисами, время «HH:MM» с двоеточием. В БД дата хранится
 * как «YYYY-MM-DD». Эти функции расшарены между онбординг-мастером и модалкой
 * редактирования натальных данных (`NatalBirthDataModal`), чтобы формат ввода
 * и валидации был идентичен в обеих точках.
 */

/** Маска даты рождения: разделители «-» появляются сразу после 2-й цифры дня
 *  и сразу после 2-й цифры месяца («07-», затем «07-11-»). При удалении
 *  хвостовой разделитель не навязывается обратно (иначе backspace зациклится). */
export function formatDateMask(raw: string, previous = ""): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const prevDigits = previous.replace(/\D/g, "");
  const deleting = digits.length < prevDigits.length;
  if (digits.length === 0) return "";
  if (digits.length <= 2) {
    return digits.length === 2 && !deleting ? `${digits}-` : digits;
  }
  if (digits.length <= 4) {
    const body = `${digits.slice(0, 2)}-${digits.slice(2)}`;
    return digits.length === 4 && !deleting ? `${body}-` : body;
  }
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}

/** Маска времени: «:» сразу после 2-й цифры часа («12:»). При удалении
 *  хвостовое двоеточие не навязывается обратно. */
export function formatTimeMask(raw: string, previous = ""): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  const prevDigits = previous.replace(/\D/g, "");
  const deleting = digits.length < prevDigits.length;
  if (digits.length === 0) return "";
  if (digits.length <= 2) {
    return digits.length === 2 && !deleting ? `${digits}:` : digits;
  }
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/** «DD-MM-YYYY» → «YYYY-MM-DD» (для API/БД) или null, если невалидно. */
export function ddmmyyyyToIso(value: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const iso = `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (d.getUTCMonth() + 1 !== mm || d.getUTCDate() !== dd || d.getUTCFullYear() !== yyyy) return null;
  return iso;
}

/** «YYYY-MM-DD» (из БД) → «DD-MM-YYYY» (для поля ввода / режима просмотра). */
export function isoToDdmmyyyy(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}
