export type TocFlatItem = {
  href: string;
  label: string;
  depth: number;
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

/** Flatten nested epub.js TOC; skip empty / Word-TOC noise. */
export function flattenToc(toc: TocNode[] | null | undefined): TocFlatItem[] {
  const out: TocFlatItem[] = [];

  const walk = (nodes: TocNode[] | undefined, depth: number) => {
    if (!nodes?.length) return;
    for (const node of nodes) {
      const label = cleanLabel(node.label);
      const href = (node.href ?? "").trim();
      const skip = !label || SKIP_LABELS.has(label.toLowerCase());
      if (!skip && href) {
        out.push({ href, label, depth });
      }
      walk(node.subitems, depth + (skip ? 0 : 1));
    }
  };

  walk(toc ?? [], 0);
  return out;
}
