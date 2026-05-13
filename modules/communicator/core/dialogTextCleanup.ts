/**
 * Mirrors `_legacy_web/app/api/_utils/markers.ts` `stripDialogScaffoldMarkdown`
 * so streamed and cached assistant text stays readable without legacy imports.
 */

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
