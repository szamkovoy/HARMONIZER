import { MARKETING_EMAIL_CONTENT_INNER_WIDTH_PX } from "../../../api/_utils/emailChrome";
import { sanitizeEmailRichHtml } from "../../../api/_utils/emailRichHtml";

export type BlockAlign = "left" | "center" | "right";
/** Web-safe stacks only — email clients ignore arbitrary fonts. */
export type BlockFontFamily =
  | "system"
  | "arial"
  | "verdana"
  | "georgia"
  | "times";
export type BlockFontSize = "sm" | "md" | "lg" | "xl";

const CONTENT_INNER_WIDTH_PX = MARKETING_EMAIL_CONTENT_INNER_WIDTH_PX;

const FONT_CSS: Record<BlockFontFamily, string> = {
  system: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
  arial: "Arial,Helvetica,sans-serif",
  verdana: "Verdana,Geneva,sans-serif",
  georgia: "Georgia,'Times New Roman',serif",
  times: "'Times New Roman',Times,serif",
};

export const FONT_FAMILY_OPTIONS: { value: BlockFontFamily; label: string }[] = [
  { value: "system", label: "System sans" },
  { value: "arial", label: "Arial" },
  { value: "verdana", label: "Verdana" },
  { value: "georgia", label: "Georgia" },
  { value: "times", label: "Times New Roman" },
];

const SIZE_CSS: Record<BlockFontSize, string> = {
  sm: "14px",
  md: "16px",
  lg: "18px",
  xl: "22px",
};

export type EmailBlock =
  | {
      id: string;
      type: "image";
      src: string;
      alt: string;
      href?: string;
      width?: string;
      /** Intrinsic pixels — used to emit height so clients reserve space before load. */
      naturalWidth?: number;
      naturalHeight?: number;
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
    case "image":
      return {
        id,
        type: "image",
        src: "",
        alt: "",
        href: "",
        // Prefer explicit px for logos; 100% fills the 560px column and looks huge in clients.
        width: "240px",
        align: "center",
        marginTop: 0,
        marginBottom: 12,
      };
    case "heading":
      return {
        id,
        type: "heading",
        html: "<h2>Заголовок</h2>",
        align: "left",
        fontFamily: "system",
        fontSize: "xl",
        marginTop: 16,
        marginBottom: 8,
      };
    case "text":
      return {
        id,
        type: "text",
        // Spacing comes from blank paragraphs / <br>, not from block margins.
        html: "<p style=\"margin:0;padding:0;\">Текст письма…</p>",
        align: "left",
        fontFamily: "system",
        fontSize: "md",
        marginTop: 0,
        marginBottom: 0,
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
    // Inner <p>/<br> spacing is finalized in wrapMarketingEmailHtml (normalizeEmailBodyHtml).
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
  const widthRaw = (block.width || "240px").trim();
  const widthIsPercent = widthRaw === "100%";
  const widthPx = widthIsPercent
    ? CONTENT_INNER_WIDTH_PX
    : parseCssPx(widthRaw) ?? 240;
  const displayW = Math.min(widthPx, CONTENT_INNER_WIDTH_PX);
  const nw = block.naturalWidth;
  const nh = block.naturalHeight;
  const displayH =
    typeof nw === "number" &&
    nw > 0 &&
    typeof nh === "number" &&
    nh > 0
      ? Math.max(1, Math.round((displayW * nh) / nw))
      : null;
  const widthCss = widthIsPercent ? "100%" : `${displayW}px`;
  const heightAttr = displayH != null ? ` height="${displayH}"` : "";
  // inline-block: parent text-align centers in email clients (block ignores it).
  // Integer width/height attrs still reserve space before the image loads.
  const img = `<img src="${src}" alt="${alt}" width="${displayW}"${heightAttr} style="width:${widthCss};max-width:100%;height:auto;display:inline-block;border:0;" />`;
  const inner = block.href
    ? `<a href="${escapeAttr(block.href)}" style="display:inline-block;text-decoration:none;">${img}</a>`
    : img;
  return `<div style="${pad}">${inner}</div>`;
}

function parseCssPx(value: string): number | null {
  const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*px$/i) || value.trim().match(/^(\d+)$/);
  if (!m) return null;
  return Math.round(Number(m[1]));
}

/** Load intrinsic size for an image URL (browser). */
export function loadImageNaturalSize(
  src: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Не удалось прочитать размер изображения"));
    img.src = src;
  });
}

/** Fill missing naturalWidth/Height on image blocks before save/render. */
export async function enrichImageBlockDimensions(
  blocks: EmailBlock[],
): Promise<EmailBlock[]> {
  return Promise.all(
    blocks.map(async (block) => {
      if (block.type !== "image" || !block.src) return block;
      if (
        typeof block.naturalWidth === "number" &&
        block.naturalWidth > 0 &&
        typeof block.naturalHeight === "number" &&
        block.naturalHeight > 0
      ) {
        return block;
      }
      try {
        const { width, height } = await loadImageNaturalSize(block.src);
        if (width <= 0 || height <= 0) return block;
        return { ...block, naturalWidth: width, naturalHeight: height };
      } catch {
        return block;
      }
    }),
  );
}

/** Clean paste bloat inside text/heading blocks (also used before persist). */
export function sanitizeEmailBlocks(blocks: EmailBlock[]): EmailBlock[] {
  return blocks.map((block) => {
    if (block.type === "text" || block.type === "heading") {
      return { ...block, html: sanitizeEmailRichHtml(block.html || "") };
    }
    return block;
  });
}

/** Render blocks to HTML body fragment (no brand chrome). Sanitizes rich text. */
export function blocksToHtml(blocks: EmailBlock[] | null | undefined): string {
  if (!blocks?.length) return "";
  return sanitizeEmailBlocks(blocks).map(blockToHtml).filter(Boolean).join("\n");
}

export function parseBlocksI18n(raw: unknown): BlocksByLocale {
  if (!raw || typeof raw !== "object") return {};
  const out: BlocksByLocale = {};
  for (const [locale, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    out[locale] = value
      .map(normalizeBlock)
      .filter((b): b is EmailBlock => b != null);
  }
  return out;
}

/** Legacy `logo` blocks become `image` (same renderer). */
function normalizeBlock(value: unknown): EmailBlock | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const t = raw.type;
  if (t === "logo") {
    return {
      id: typeof raw.id === "string" ? raw.id : newBlockId(),
      type: "image",
      src: typeof raw.src === "string" ? raw.src : "",
      alt: typeof raw.alt === "string" ? raw.alt : "",
      href: typeof raw.href === "string" ? raw.href : "",
      width: typeof raw.width === "string" ? raw.width : "240px",
      align:
        raw.align === "left" || raw.align === "center" || raw.align === "right"
          ? raw.align
          : "center",
      marginTop: typeof raw.marginTop === "number" ? raw.marginTop : 0,
      marginBottom: typeof raw.marginBottom === "number" ? raw.marginBottom : 12,
    };
  }
  if (t === "image" || t === "heading" || t === "text" || t === "button") {
    return value as EmailBlock;
  }
  return null;
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
      marginTop: 0,
      marginBottom: 0,
    },
  ];
}
