export type TocFlatItem = {
  href: string;
  label: string;
  depth: number;
  /** True when the TOC node has no child entries (chapter / prologue / etc.). */
  isLeaf: boolean;
};

type TocNode = {
  href?: string;
  label?: string;
  subitems?: TocNode[];
};

const SKIP_LABELS = new Set(["оглавление", "table of contents", "contents"]);

function cleanLabel(label: string | undefined): string {
  return (label ?? "").replace(/\s+/g, " ").trim();
}

/** Part-level headings («Часть I…» / «Part II…»). */
export function isPartTocLabel(label: string | null | undefined): boolean {
  const s = (label ?? "").trim();
  if (!s) return false;
  // Avoid `\b` — JS word boundaries don't treat Cyrillic as word chars.
  return /^часть([\s:].*|$)/i.test(s) || /^part([\s:].*|$)/i.test(s);
}

/** Flatten nested epub.js TOC; skip empty / Word-TOC noise. */
export function flattenToc(toc: TocNode[] | null | undefined): TocFlatItem[] {
  const out: TocFlatItem[] = [];

  const walk = (nodes: TocNode[] | undefined, depth: number) => {
    if (!nodes?.length) return;
    for (const node of nodes) {
      const label = cleanLabel(node.label);
      const href = (node.href ?? "").trim();
      const skip = !label || SKIP_LABELS.has(label.toLowerCase());
      const kids = node.subitems?.length ? node.subitems : [];
      const hasKids = kids.length > 0;
      if (!skip && href) {
        out.push({ href, label, depth, isLeaf: !hasKids });
      }
      walk(kids, depth + (skip ? 0 : 1));
    }
  };

  walk(toc ?? [], 0);
  return out;
}

/** Footer / chrome: only real chapters (leaves), never «Часть I/II…». */
export function chapterTocItems(toc: TocFlatItem[]): TocFlatItem[] {
  return toc.filter((item) => item.isLeaf && !isPartTocLabel(item.label));
}

/**
 * Labels allowed in the reader footer sticky/seed.
 * Parts («Часть III: Яма») are allowed — they are real navigation targets.
 * Workshop parent «Практикум» is not a reading position label.
 */
export function isChapterFooterLabel(label: string | null | undefined): boolean {
  const s = (label ?? "").trim();
  if (!s) return false;
  if (/^практикум$/i.test(s) || /^практика$/i.test(s)) return false;
  return true;
}
