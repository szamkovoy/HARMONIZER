import type { TocFlatItem } from "./flattenToc";

export type LiveAnchor = {
  cfi: string | null;
  href: string | null;
  location: number | null;
  percentage: number | null;
  atEnd: boolean;
  /** Visible text from the top of the current page — survives font reflow better than CFI alone. */
  snippet: string | null;
};

/** Ask the WebView for rendition.currentLocation() + a text snippet. */
export const CAPTURE_LIVE_ANCHOR_JS = `
  (function () {
    function send(payload) {
      try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      } catch (e) {}
    }
    function normSpace(s) {
      return String(s || "").replace(/\\s+/g, " ").trim();
    }
    function snippetFromStart(start) {
      try {
        if (!rendition) return null;
        var list = typeof rendition.getContents === "function" ? rendition.getContents() : null;
        var contents = null;
        if (list && list.length) {
          for (var i = 0; i < list.length; i++) {
            if (list[i]) { contents = list[i]; break; }
          }
        }
        if (!contents || !contents.document) return null;
        var text = "";
        try {
          if (start && start.cfi && typeof contents.range === "function") {
            var range = contents.range(start.cfi);
            if (range) {
              var node = range.startContainer;
              var offset = range.startOffset || 0;
              if (node && node.nodeType === 3) {
                text = String(node.textContent || "").slice(offset);
                var n = node;
                while (text.length < 120 && n) {
                  var next = n.nextSibling;
                  while (!next && n.parentNode && n.parentNode !== contents.document.body) {
                    n = n.parentNode;
                    next = n.nextSibling;
                  }
                  if (!next) break;
                  n = next;
                  if (n.nodeType === 3) text += " " + String(n.textContent || "");
                  else if (n.textContent) text += " " + String(n.textContent || "");
                }
              } else if (range.toString) {
                text = range.toString();
              }
            }
          }
        } catch (e1) {}
        if (normSpace(text).length < 16) {
          try {
            var doc = contents.document;
            var el = doc.elementFromPoint
              ? (doc.elementFromPoint(24, 56) || doc.elementFromPoint(doc.documentElement.clientWidth / 2, 80))
              : null;
            var block = el;
            while (block && block !== doc.body) {
              var tag = (block.tagName || "").toLowerCase();
              if (tag === "p" || tag === "li" || tag === "h1" || tag === "h2" || tag === "h3" || tag === "blockquote") break;
              block = block.parentElement;
            }
            if (block && block.textContent) text = block.textContent;
            else if (doc.body) text = doc.body.innerText || doc.body.textContent || "";
          } catch (e2) {}
        }
        text = normSpace(text);
        if (text.length < 12) return null;
        return text.slice(0, 120);
      } catch (err) {
        return null;
      }
    }
    try {
      if (typeof rendition === "undefined" || !rendition) {
        send({ type: "hzAnchor", error: "no-rendition" });
        return true;
      }
      var loc = rendition.currentLocation();
      var start = loc && loc.start ? loc.start : null;
      var end = loc && loc.end ? loc.end : null;
      var pct = null;
      if (start && typeof start.percentage === "number") {
        pct = end && typeof end.percentage === "number"
          ? (start.percentage + end.percentage) / 2
          : start.percentage;
      }
      if ((pct == null || !(pct > 0)) && start && start.cfi && book && book.locations && typeof book.locations.percentageFromCfi === "function") {
        try {
          var fromCfi = book.locations.percentageFromCfi(start.cfi);
          if (typeof fromCfi === "number" && isFinite(fromCfi)) pct = fromCfi;
        } catch (e) {}
      }
      var atEnd = !!(loc && loc.atEnd);
      if (!atEnd && typeof pct === "number" && pct >= 0.995) atEnd = true;
      var locIdx = start && typeof start.location === "number" ? start.location : null;
      // epub.js uses -1 before locations are ready — treat as missing.
      if (typeof locIdx === "number" && locIdx < 0) locIdx = null;
      send({
        type: "hzAnchor",
        cfi: start && start.cfi ? start.cfi : null,
        href: start && start.href ? start.href : null,
        location: locIdx,
        percentage: typeof pct === "number" && isFinite(pct) ? pct : null,
        atEnd: atEnd,
        snippet: snippetFromStart(start)
      });
    } catch (err) {
      send({ type: "hzAnchor", error: String(err && err.message ? err.message : err) });
    }
    return true;
  })();
  true;
`;

export function parseLiveAnchorMessage(msg: unknown): LiveAnchor | null {
  const data = msg as {
    type?: string;
    cfi?: string | null;
    href?: string | null;
    location?: number | null;
    percentage?: number | null;
    atEnd?: boolean;
    snippet?: string | null;
    error?: string;
  };
  if (data?.type !== "hzAnchor" || data.error) return null;
  const snippet =
    typeof data.snippet === "string" && data.snippet.trim().length >= 12
      ? data.snippet.replace(/\s+/g, " ").trim().slice(0, 120)
      : null;
  const location = typeof data.location === "number" && data.location >= 0 ? data.location : null;
  const percentage =
    typeof data.percentage === "number" && Number.isFinite(data.percentage) ? data.percentage : null;
  return {
    cfi: data.cfi ?? null,
    href: data.href ?? null,
    location,
    percentage,
    atEnd: !!data.atEnd,
    snippet,
  };
}

/** Reject placeholders before locations are ready / empty CFIs. */
export function isUsableAnchor(anchor: LiveAnchor | null | undefined): boolean {
  if (!anchor?.cfi) return false;
  if (typeof anchor.location === "number" && anchor.location < 0) return false;
  return true;
}

export function isZeroishProgress(percentage: number | null | undefined, location: number | null | undefined): boolean {
  if (typeof percentage === "number" && percentage <= 0.002) return true;
  if (percentage == null && typeof location === "number" && location === 0) return true;
  return false;
}

/** Saved progress percent (0–100). Ignore corrupt ~0 values left by location flashes. */
export function normalizeSeedPercent(percent: number | null | undefined): number | null {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return null;
  if (percent <= 1) return null;
  return Math.min(100, Math.max(0, percent));
}

/**
 * While restoring mid-book, ignore flash-of-start events (0% / loc 0) that wipe chrome + resume %.
 */
export function shouldAcceptAnchor(
  prev: LiveAnchor | null,
  next: LiveAnchor,
  opts?: { restoring?: boolean; resumePercentage?: number | null; seedPercent?: number | null },
): boolean {
  if (!isUsableAnchor(next)) return false;
  const resumePct =
    typeof opts?.resumePercentage === "number"
      ? opts.resumePercentage
      : typeof opts?.seedPercent === "number"
        ? opts.seedPercent / 100
        : null;
  const looksLikeStart = !next.atEnd && isZeroishProgress(next.percentage, next.location);
  if (looksLikeStart && typeof resumePct === "number" && resumePct > 0.05) {
    return false;
  }
  if (
    prev?.cfi &&
    typeof prev.percentage === "number" &&
    prev.percentage > 0.05 &&
    looksLikeStart &&
    next.cfi !== prev.cfi
  ) {
    return false;
  }
  return true;
}

function normFile(href: string): string {
  const noHash = href.split("#")[0] ?? href;
  return noHash.replace(/^.*\//, "").trim().toLowerCase();
}

/** Best TOC label for the spine file currently on screen. */
export function tocLabelForHref(href: string | null | undefined, toc: TocFlatItem[]): string | null {
  if (!href || !toc.length) return null;
  const file = normFile(href);
  if (!file || file.length < 4) return null;
  const frag = href.includes("#") ? (href.split("#")[1] ?? "").toLowerCase() : "";

  let fileMatch: TocFlatItem | null = null;
  for (const item of toc) {
    const itemFile = normFile(item.href);
    if (!itemFile) continue;
    const sameFile = itemFile === file || itemFile.endsWith(file) || file.endsWith(itemFile);
    if (!sameFile) continue;
    if (frag) {
      const itemFrag = item.href.includes("#") ? (item.href.split("#")[1] ?? "").toLowerCase() : "";
      if (itemFrag && (itemFrag === frag || frag.startsWith(itemFrag) || itemFrag.startsWith(frag))) {
        return item.label;
      }
    }
    fileMatch = item;
  }
  return fileMatch?.label ?? null;
}

function pageFromPercent(total: number, ratio: number): number {
  if (total === 1) return 1;
  if (ratio >= 0.995) return total;
  return Math.min(total, Math.max(1, Math.round(ratio * (total - 1)) + 1));
}

export function pageIndexFromAnchor(
  anchor: LiveAnchor | null,
  totalLocations: number | null,
  fallbackLocation: number | null,
  seedPercent?: number | null,
): number | null {
  const total = typeof totalLocations === "number" && totalLocations > 0 ? totalLocations : null;
  if (total == null) return null;
  if (anchor?.atEnd) return total;

  const seed = normalizeSeedPercent(seedPercent);
  const seedRatio = seed != null ? seed / 100 : null;

  const pct = typeof anchor?.percentage === "number" ? anchor.percentage : null;
  if (pct != null && Number.isFinite(pct)) {
    // Zeroish % is a locations flash — prefer seed when we know we're mid-book.
    if (!(pct <= 0.002 && seedRatio != null && seedRatio > 0.05)) {
      return pageFromPercent(total, pct);
    }
  }

  const locIdx = typeof anchor?.location === "number" ? anchor.location : fallbackLocation;
  if (typeof locIdx === "number" && locIdx > 0) {
    return Math.min(total, Math.max(1, locIdx + 1));
  }
  // location 0 with mid-book seed → seed wins
  if (typeof locIdx === "number" && locIdx === 0 && (seedRatio == null || seedRatio <= 0.05)) {
    return 1;
  }

  if (seedRatio != null) return pageFromPercent(total, seedRatio);
  return null;
}

export function progressRatioFromAnchor(
  anchor: LiveAnchor | null,
  totalLocations: number | null,
  fallbackLocation: number | null,
  seedPercent?: number | null,
): number {
  if (anchor?.atEnd) return 1;
  const seed = normalizeSeedPercent(seedPercent);
  const seedRatio = seed != null ? seed / 100 : null;

  const pct = typeof anchor?.percentage === "number" ? anchor.percentage : null;
  if (pct != null && Number.isFinite(pct)) {
    if (!(pct <= 0.002 && seedRatio != null && seedRatio > 0.05)) {
      return Math.min(1, Math.max(0, pct));
    }
  }

  const total = typeof totalLocations === "number" ? totalLocations : 0;
  const locIdx = typeof anchor?.location === "number" ? anchor.location : fallbackLocation;
  if (typeof locIdx === "number" && locIdx > 0 && total > 1) {
    return Math.min(1, Math.max(0, locIdx / (total - 1)));
  }

  if (seedRatio != null) return seedRatio;
  return 0;
}

export function pickRicherAnchor(a: LiveAnchor | null, b: LiveAnchor | null): LiveAnchor | null {
  if (!a) return b;
  if (!b) return a;
  const score = (x: LiveAnchor) =>
    (x.snippet ? 4 : 0) +
    (typeof x.percentage === "number" && x.percentage > 0.002 ? 2 : 0) +
    (typeof x.location === "number" && x.location > 0 ? 1 : 0) +
    (x.cfi ? 1 : 0);
  return score(b) > score(a) ? b : a;
}
