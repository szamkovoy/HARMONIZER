import sharp from "sharp";

import { MARKETING_EMAIL_CONTENT_INNER_WIDTH_PX } from "./emailChrome";
import {
  wrapMarketingEmailHtml,
  type WrapEmailOptions,
} from "./emailTemplate";

const CONTENT_INNER_WIDTH_PX = MARKETING_EMAIL_CONTENT_INNER_WIDTH_PX;

const probeCache = new Map<string, { width: number; height: number }>();

function readAttr(tag: string, name: string): string | null {
  const quoted = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"),
  );
  if (quoted) return quoted[1];
  const bare = tag.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i"));
  return bare?.[1] ?? null;
}

function parsePx(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t || t === "100%") return null;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*px$/i) || t.match(/^(\d+)$/);
  if (!m) return null;
  return Math.round(Number(m[1]));
}

async function probeImageUrl(
  url: string,
): Promise<{ width: number; height: number } | null> {
  const cached = probeCache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    const dims = { width: meta.width, height: meta.height };
    probeCache.set(url, dims);
    return dims;
  } catch {
    return null;
  }
}

/** CSS `width:` only — must not match inside `max-width:`. */
function readStyleWidth(style: string): string | null {
  const m = style.match(/(?:^|;)\s*width\s*:\s*([^;]+)/i);
  return m?.[1]?.trim() ?? null;
}

function rebuildImgTag(
  tag: string,
  displayW: number,
  displayH: number,
  widthIsPercent: boolean,
): string {
  const src = readAttr(tag, "src") ?? "";
  const alt = readAttr(tag, "alt") ?? "";
  const widthCss = widthIsPercent ? "100%" : `${displayW}px`;
  // Keep inline-block so parent text-align:center works in mail clients.
  return `<img src="${src}" alt="${alt}" width="${displayW}" height="${displayH}" style="width:${widthCss};max-width:100%;height:auto;display:inline-block;border:0;" />`;
}

/**
 * Reserve vertical space for images before they load (email CLS).
 * Injects integer width/height from intrinsic image size when missing.
 */
export async function ensureImgDimensionsInHtml(html: string): Promise<string> {
  if (!html.includes("<img")) return html;

  const re = /<img\b[^>]*>/gi;
  const matches = [...html.matchAll(re)];
  if (!matches.length) return html;

  const replacements: { start: number; end: number; next: string }[] = [];

  for (const m of matches) {
    const tag = m[0];
    const start = m.index ?? 0;
    const end = start + tag.length;
    const src = readAttr(tag, "src");
    if (!src || src.startsWith("data:")) continue;

    const heightAttr = readAttr(tag, "height");
    const widthAttr = readAttr(tag, "width");
    const style = readAttr(tag, "style") ?? "";
    const styleWidth = readStyleWidth(style);
    const widthIsPercent = widthAttr === "100%" || styleWidth === "100%";

    const goodHeight = Boolean(heightAttr && /^\d+$/.test(heightAttr));
    const goodWidth = Boolean(widthAttr && /^\d+$/.test(widthAttr));
    // Re-normalize when style width was wrongly set to 100% (legacy max-width bug).
    const styleForcesFullWidth =
      styleWidth === "100%" && Boolean(parsePx(widthAttr));
    // display:block breaks parent text-align:center in mail clients.
    const styleForcesBlock = /(?:^|;)\s*display\s*:\s*block\b/i.test(style);
    if (
      goodHeight &&
      goodWidth &&
      !styleForcesFullWidth &&
      !styleForcesBlock
    ) {
      continue;
    }

    const dims = await probeImageUrl(src);
    if (!dims) continue;

    const explicitW = parsePx(styleWidth) ?? parsePx(widthAttr);
    const displayW = Math.min(
      explicitW ?? (widthIsPercent ? CONTENT_INNER_WIDTH_PX : dims.width),
      CONTENT_INNER_WIDTH_PX,
    );
    const displayH = Math.max(
      1,
      Math.round((displayW * dims.height) / dims.width),
    );
    // Prefer explicit px from the tag/block; only use 100% when author chose it.
    const usePercent = widthIsPercent && explicitW == null;

    replacements.push({
      start,
      end,
      next: rebuildImgTag(tag, displayW, displayH, usePercent),
    });
  }

  let out = html;
  for (const r of replacements.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, r.start) + r.next + out.slice(r.end);
  }
  return out;
}

/** Server send path: reserve image space then wrap chrome. */
export async function prepareMarketingEmailHtml(
  opts: WrapEmailOptions,
): Promise<string> {
  const bodyHtml = await ensureImgDimensionsInHtml(opts.bodyHtml);
  return wrapMarketingEmailHtml({ ...opts, bodyHtml });
}
