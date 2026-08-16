/**
 * Mirrors `_legacy_web/app/api/_utils/markers.ts` `stripDialogScaffoldMarkdown`
 * so streamed and cached assistant text stays readable without legacy imports.
 */

const INTERNAL_MARKER_NAMES = [
  "STATE_PROPOSAL",
  "PRACTICE_PICK",
  "PRACTICE_DECLINED",
  "CORRECT_RECOMMENDATION",
  "PLANNED_EVENT",
  "SUMMARIZE_EVENT",
  "SIMULATE_EVENT",
  "CANCEL_EVENT",
  "MATRIX_CELLS",
  "PLAN_TOMORROW",
  "READY_FOR_RECOMMENDATION",
  "BRANCH_DONE",
] as const;

const INTERNAL_MARKER_ALT = INTERNAL_MARKER_NAMES.join("|");

const INTERNAL_BARE_MARKER_RE = new RegExp(
  `\\[\\s*(?:${INTERNAL_MARKER_ALT})\\s*\\]`,
  "gi",
);

const ATTRIBUTED_INTERNAL_MARKER_RE = new RegExp(
  `\\[(STATE_PROPOSAL|PRACTICE_PICK|CORRECT_RECOMMENDATION|PLANNED_EVENT|SUMMARIZE_EVENT|SIMULATE_EVENT|CANCEL_EVENT|MATRIX_CELLS):[^\\]]*\\]`,
  "gi",
);

const XML_CLOSE_RE = new RegExp(`<\\/\\s*(?:${INTERNAL_MARKER_ALT})\\s*>`, "gi");
const XML_OPEN_RE = new RegExp(`<\\s*(?:${INTERNAL_MARKER_ALT})\\b[^>]*>`, "gi");
const TRAILING_OPEN_XML_RE = new RegExp(`<\\s*(?:${INTERNAL_MARKER_ALT})\\b[\\s\\S]*$`, "i");
const PROTOCOL_ATTR_RE =
  /\b(?:display_order|short_text|time_norm|outcome_cells|card_blurb|windows_correction|duration_min)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s<>]+)/gi;
const QUOTED_PROTOCOL_ATTR_RE =
  /\b(?:desc|recommendation|spheres|cells|ref|outcome|id|reason|chakra)\s*=\s*(?:"[^"]*"|'[^']*')/gi;
const UNQUOTED_SPHERES_RE = /\bspheres\s*=\s*\d[\d.:;]*/gi;

export function stripInternalDialogMarkers(text: string): string {
  return text
    .replace(ATTRIBUTED_INTERNAL_MARKER_RE, "")
    .replace(INTERNAL_BARE_MARKER_RE, "")
    .replace(XML_CLOSE_RE, "")
    .replace(XML_OPEN_RE, "")
    .replace(PROTOCOL_ATTR_RE, "")
    .replace(QUOTED_PROTOCOL_ATTR_RE, "")
    .replace(UNQUOTED_SPHERES_RE, "")
    .replace(TRAILING_OPEN_XML_RE, "")
    .replace(/<\/?\s*>/g, "")
    .replace(/(?:^|\n)\s*>\s*(?=\n|$)/g, "\n")
    .replace(/^\s*>\s*/, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}

/** Убирает `---` и целиком блоки `**…**` (как на сервере в `markers.ts`). */
export function stripDialogScaffoldMarkdown(text: string): string {
  let t = stripInternalDialogMarkers(text.replace(/\r\n/g, "\n"));
  t = t.replace(/^\s*-{3,}\s*$/gm, "");
  for (let i = 0; i < 16; i++) {
    const prev = t;
    t = t.replace(/\*\*[^*]+\*\*/g, "");
    if (t === prev) break;
  }
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}
