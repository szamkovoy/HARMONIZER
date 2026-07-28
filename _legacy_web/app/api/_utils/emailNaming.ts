/**
 * Shared naming for campaigns and automation steps (list title + copy suffix).
 * One place so рассылки and цепочки stay identical.
 */

export function emailListTitle(
  name: string | null | undefined,
  subject: string | null | undefined,
): string {
  return (name ?? "").trim() || (subject ?? "").trim() || "Без названия";
}

/** Subject line under the title only when both name and subject are set. */
export function emailListSubjectSubtitle(
  name: string | null | undefined,
  subject: string | null | undefined,
): string | null {
  const n = (name ?? "").trim();
  const s = (subject ?? "").trim();
  return n && s ? s : null;
}

/** Name for a duplicated item: «… (копия)». */
export function emailCopyName(
  name: string | null | undefined,
  subject?: string | null,
  emptyFallback = "Копия",
): string {
  const base = (name ?? "").trim() || (subject ?? "").trim() || emptyFallback;
  return `${base} (копия)`;
}
