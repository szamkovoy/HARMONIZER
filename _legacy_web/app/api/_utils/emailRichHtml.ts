/**
 * Strip paste/editor bloat from rich-text HTML inside email blocks.
 * Safe for admin client + server (no DOM). Run on save so stored html_body
 * matches what preview/send use after wrap.
 */

import { normalizeEmailBodyHtml } from "./emailTemplate";

const STYLE_KEEP = new Set([
  "font-weight",
  "font-style",
  "text-decoration",
  "text-align",
  "color",
]);

function isDefaultColor(value: string): boolean {
  const v = value.trim().toLowerCase().replace(/\s+/g, "");
  return (
    v === "#000" ||
    v === "#000000" ||
    v === "black" ||
    v === "rgb(0,0,0)" ||
    v === "rgba(0,0,0,1)" ||
    v === "rgb(0,0,0,1)"
  );
}

/** Keep only email-useful declarations; drop Apple/Word font longhands. */
export function sanitizeInlineStyle(style: string): string {
  const kept: string[] = [];
  for (const raw of style.split(";")) {
    const part = raw.trim();
    if (!part) continue;
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const val = part.slice(colon + 1).trim();
    if (!val || !STYLE_KEEP.has(prop)) continue;
    if (prop === "font-weight" && /^(normal|400)$/i.test(val)) continue;
    if (prop === "font-style" && /^normal$/i.test(val)) continue;
    if (prop === "text-decoration" && /^none$/i.test(val)) continue;
    if (prop === "color" && isDefaultColor(val)) continue;
    kept.push(`${prop}:${val}`);
  }
  return kept.join(";");
}

function stripBannedAttrs(attrs: string): string {
  return attrs
    .replace(/\s(?:class|id|dir|lang|face|size)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\sstyle\s*=\s*"([^"]*)"/gi, (_m, style: string) => {
      const next = sanitizeInlineStyle(style);
      return next ? ` style="${next}"` : "";
    })
    .replace(/\sstyle\s*=\s*'([^']*)'/gi, (_m, style: string) => {
      const next = sanitizeInlineStyle(style);
      return next ? ` style="${next}"` : "";
    });
}

/**
 * Clean contentEditable / paste HTML for marketing emails.
 * Preserves structure (p/br/a/b/i/strong/em/u) and useful inline emphasis.
 */
export function sanitizeEmailRichHtml(html: string): string {
  if (!html?.trim()) return html || "";

  let out = html
    // Word/Outlook/Apple chrome
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?(?:meta|style|xml|link|script|title)[^>]*>/gi, "")
    .replace(/<\/?(?:o:p|w:[a-z0-9:]+)[^>]*>/gi, "");

  // Rebuild start tags with sanitized attributes (keep tag name + href/target/rel for <a>).
  out = out.replace(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_full, tag: string, attrs: string) => {
    const t = tag.toLowerCase();
    if (t === "br") return "<br>";
    let nextAttrs = stripBannedAttrs(attrs);

    if (t === "a") {
      const href = attrs.match(/\shref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i)?.[0] ?? "";
      const target = attrs.match(/\starget\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i)?.[0] ?? "";
      const rel = attrs.match(/\srel\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i)?.[0] ?? "";
      const style = nextAttrs.match(/\sstyle\s*=\s*"[^"]*"/i)?.[0] ?? "";
      nextAttrs = `${href}${target}${rel}${style}`;
    } else if (t === "img") {
      // Images inside rich text are rare; keep src/alt/width/height + cleaned style.
      const keep =
        attrs.match(/\s(?:src|alt|width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)?.join("") ??
        "";
      const style = nextAttrs.match(/\sstyle\s*=\s*"[^"]*"/i)?.[0] ?? "";
      nextAttrs = `${keep}${style}`;
    } else {
      // Non-anchor: only cleaned style may remain.
      const style = nextAttrs.match(/\sstyle\s*=\s*"[^"]*"/i)?.[0] ?? "";
      nextAttrs = style;
    }

    return `<${t}${nextAttrs}>`;
  });

  // Unwrap attribute-less span/font wrappers (iterate for nesting).
  for (let i = 0; i < 6; i++) {
    const before = out;
    out = out.replace(/<\/?(?:font)[^>]*>/gi, "");
    out = out.replace(/<span\s*>([\s\S]*?)<\/span>/gi, "$1");
    if (out === before) break;
  }

  // Collapse leftover empty spans with only whitespace between tags.
  out = out.replace(/<span\s*><\/span>/gi, "");

  return normalizeEmailBodyHtml(out);
}
