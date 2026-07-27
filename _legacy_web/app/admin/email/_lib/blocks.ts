export type BlockAlign = "left" | "center" | "right";
export type BlockFontFamily = "system" | "georgia";
export type BlockFontSize = "sm" | "md" | "lg" | "xl";

const FONT_CSS: Record<BlockFontFamily, string> = {
  system: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
  georgia: "Georgia,'Times New Roman',serif",
};

const SIZE_CSS: Record<BlockFontSize, string> = {
  sm: "14px",
  md: "16px",
  lg: "18px",
  xl: "22px",
};

export type EmailBlock =
  | {
      id: string;
      type: "logo" | "image";
      src: string;
      alt: string;
      href?: string;
      width?: string;
      align?: BlockAlign;
      marginTop?: number;
      marginBottom?: number;
    }
  | {
      id: string;
      type: "heading";
      html: string;
      align?: BlockAlign;
      fontFamily?: BlockFontFamily;
      fontSize?: BlockFontSize;
      marginTop?: number;
      marginBottom?: number;
    }
  | {
      id: string;
      type: "text";
      html: string;
      align?: BlockAlign;
      fontFamily?: BlockFontFamily;
      fontSize?: BlockFontSize;
      marginTop?: number;
      marginBottom?: number;
    }
  | {
      id: string;
      type: "button";
      label: string;
      href: string;
      color?: string;
      align?: BlockAlign;
      marginTop?: number;
      marginBottom?: number;
    };

export type BlocksByLocale = Record<string, EmailBlock[]>;

export function newBlockId(): string {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyBlock(type: EmailBlock["type"]): EmailBlock {
  const id = newBlockId();
  switch (type) {
    case "logo":
    case "image":
      return {
        id,
        type,
        src: "",
        alt: type === "logo" ? "Логотип" : "",
        href: "",
        width: "100%",
        align: "center",
        marginTop: 8,
        marginBottom: 8,
      };
    case "heading":
      return {
        id,
        type: "heading",
        html: "<h2>Заголовок</h2>",
        align: "left",
        fontFamily: "system",
        fontSize: "xl",
        marginTop: 12,
        marginBottom: 8,
      };
    case "text":
      return {
        id,
        type: "text",
        html: "<p>Текст письма…</p>",
        align: "left",
        fontFamily: "system",
        fontSize: "md",
        marginTop: 8,
        marginBottom: 8,
      };
    case "button":
      return {
        id,
        type: "button",
        label: "Перейти",
        href: "https://",
        color: "#0f3d2e",
        align: "center",
        marginTop: 16,
        marginBottom: 16,
      };
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function blockToHtml(block: EmailBlock): string {
  const mt = block.marginTop ?? 0;
  const mb = block.marginBottom ?? 0;
  const align = block.align ?? "left";
  const pad = `margin:${mt}px 0 ${mb}px;text-align:${align};`;

  if (block.type === "heading" || block.type === "text") {
    const family = FONT_CSS[block.fontFamily ?? "system"];
    const size = SIZE_CSS[block.fontSize ?? (block.type === "heading" ? "xl" : "md")];
    const weight = block.type === "heading" ? "font-weight:700;" : "";
    return `<div style="${pad}font-family:${family};font-size:${size};line-height:1.55;${weight}">${block.html || ""}</div>`;
  }

  if (block.type === "button") {
    const color = block.color || "#0f3d2e";
    const label = escapeAttr(block.label || "Кнопка");
    const href = escapeAttr(block.href || "#");
    return `<div style="${pad}">
  <a href="${href}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-family:system-ui,sans-serif;font-size:15px;font-weight:600;">${label}</a>
</div>`;
  }

  if (!block.src) return "";
  const src = escapeAttr(block.src);
  const alt = escapeAttr(block.alt || "");
  const width = escapeAttr(block.width || "100%");
  const img = `<img src="${src}" alt="${alt}" width="${width}" style="max-width:100%;height:auto;display:inline-block;border:0;" />`;
  const inner = block.href
    ? `<a href="${escapeAttr(block.href)}" style="text-decoration:none;">${img}</a>`
    : img;
  return `<div style="${pad}">${inner}</div>`;
}

/** Render blocks to HTML body fragment (no brand chrome). */
export function blocksToHtml(blocks: EmailBlock[] | null | undefined): string {
  if (!blocks?.length) return "";
  return blocks.map(blockToHtml).filter(Boolean).join("\n");
}

export function parseBlocksI18n(raw: unknown): BlocksByLocale {
  if (!raw || typeof raw !== "object") return {};
  const out: BlocksByLocale = {};
  for (const [locale, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    out[locale] = value.filter(isEmailBlock);
  }
  return out;
}

function isEmailBlock(value: unknown): value is EmailBlock {
  if (!value || typeof value !== "object") return false;
  const t = (value as { type?: string }).type;
  return t === "logo" || t === "image" || t === "heading" || t === "text" || t === "button";
}

export function localeHasEmailCopy(
  locale: string,
  subjectRu: string,
  subjectI18n: Record<string, string>,
  htmlRu: string,
  htmlI18n: Record<string, string>,
  blocksI18n: BlocksByLocale,
): boolean {
  const subject =
    locale === "ru" ? subjectRu.trim() : (subjectI18n[locale] ?? "").trim();
  if (!subject) return false;
  const blocks = blocksI18n[locale] ?? (locale === "ru" ? blocksI18n.ru : undefined);
  if (blocks?.length && blocksToHtml(blocks).trim()) return true;
  const html = locale === "ru" ? htmlRu.trim() : (htmlI18n[locale] ?? "").trim();
  return Boolean(html);
}

export function blocksForLocale(
  blocksI18n: BlocksByLocale,
  locale: string,
): EmailBlock[] {
  return blocksI18n[locale] ?? [];
}

export function ensureBlocksFromHtml(html: string): EmailBlock[] {
  const trimmed = html.trim();
  if (!trimmed) return [createEmptyBlock("text")];
  return [
    {
      id: newBlockId(),
      type: "text",
      html: trimmed,
      align: "left",
      fontFamily: "system",
      fontSize: "md",
      marginTop: 8,
      marginBottom: 8,
    },
  ];
}
