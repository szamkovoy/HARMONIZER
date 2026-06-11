/**
 * Mirrors `_legacy_web/app/api/_utils/markers.ts` `stripDialogScaffoldMarkdown`
 * so streamed and cached assistant text stays readable without legacy imports.
 */

const INTERNAL_BARE_MARKER_RE =
  /\[\s*(?:STATE_PROPOSAL|PRACTICE_PICK|PRACTICE_DECLINED|CORRECT_RECOMMENDATION|PLANNED_EVENT|SUMMARIZE_EVENT|MATRIX_CELLS|PLAN_TOMORROW|READY_FOR_RECOMMENDATION)\s*\]/gi;

export function stripInternalDialogMarkers(text: string): string {
  return text.replace(INTERNAL_BARE_MARKER_RE, "").replace(/[ \t]+\n/g, "\n").trim();
}

/** Убирает `---` и целиком блоки `**…**` (как на сервере в `markers.ts`). */
export function stripDialogScaffoldMarkdown(text: string): string {
  let t = text.replace(/\r\n/g, "\n");
  t = t.replace(/^\s*-{3,}\s*$/gm, "");
  for (let i = 0; i < 16; i++) {
    const prev = t;
    t = t.replace(/\*\*[^*]+\*\*/g, "");
    if (t === prev) break;
  }
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}
