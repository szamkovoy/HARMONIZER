import type { TocFlatItem } from "./flattenToc";

export type LiveAnchor = {
  cfi: string | null;
  href: string | null;
  /** Spine href + fragment of the active TOC entry (many chapters share one xhtml). */
  tocHref: string | null;
  /** How tocHref was resolved — visible headings are trusted; CFI may flash. */
  tocSource?: "visible" | "cfi" | "eof" | null;
  location: number | null;
  percentage: number | null;
  atEnd: boolean;
  /** Visible text from the top of the current page — survives font reflow better than CFI alone. */
  snippet: string | null;
};

/**
 * Ask the WebView for rendition.currentLocation() + text snippet + TOC fragment.
 * Leaf TOC only (skip «Часть…» parents). Match contents iframe to start.href in continuous mode.
 */
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
    function fileLeaf(href) {
      var noHash = String(href || "").split("#")[0];
      var parts = noHash.split("/");
      return (parts[parts.length - 1] || noHash).toLowerCase();
    }
    function normFrag(frag) {
      var raw = String(frag || "").trim();
      if (!raw) return "";
      try { return decodeURIComponent(raw).toLowerCase(); } catch (e) { return raw.toLowerCase(); }
    }
    /** Chapter-level TOC entries (no parents with subitems). */
    function flattenLeafToc(items, out) {
      if (!items || !items.length) return out;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it) continue;
        var kids = it.subitems && it.subitems.length ? it.subitems : null;
        if (kids) {
          flattenLeafToc(kids, out);
        } else if (it.href) {
          out.push(it);
        }
      }
      return out;
    }
    /** All TOC entries with href — includes «Часть…» parents for footer/nav. */
    function flattenAllToc(items, out) {
      if (!items || !items.length) return out;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it) continue;
        if (it.href) out.push(it);
        if (it.subitems && it.subitems.length) flattenAllToc(it.subitems, out);
      }
      return out;
    }
    function leafToc() {
      try {
        if (!book || !book.navigation || !book.navigation.toc) return [];
        return flattenLeafToc(book.navigation.toc, []);
      } catch (e) {
        return [];
      }
    }
    function allToc() {
      try {
        if (!book || !book.navigation || !book.navigation.toc) return [];
        return flattenAllToc(book.navigation.toc, []);
      } catch (e) {
        return [];
      }
    }
    function sameFile(a, b) {
      var fa = fileLeaf(a);
      var fb = fileLeaf(b);
      if (!fa || !fb) return false;
      return fa === fb || fa.endsWith(fb) || fb.endsWith(fa);
    }
    /** Canonical TOC href for file + id (chapters and «Часть…» parents). */
    function tocHrefForId(file, id) {
      var entries = allToc();
      var idNorm = normFrag(id);
      if (!idNorm) return null;
      for (var i = 0; i < entries.length; i++) {
        var h = entries[i].href || "";
        if (!sameFile(h, file)) continue;
        var hash = h.indexOf("#") >= 0 ? h.split("#")[1] : "";
        var hf = normFrag(hash);
        if (hf && (hf === idNorm || idNorm.indexOf(hf) === 0 || hf.indexOf(idNorm) === 0)) {
          return h;
        }
      }
      return null;
    }
    function contentsForStart(start) {
      try {
        var list = rendition.getContents && rendition.getContents();
        if (!list || !list.length) return null;
        var want = start && start.href ? fileLeaf(start.href) : "";
        if (want) {
          for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (!c) continue;
            var chref = "";
            try {
              if (c.section && c.section.href) chref = c.section.href;
              else if (c.content && c.content.href) chref = c.content.href;
            } catch (e1) {}
            if (chref && fileLeaf(chref) === want) return c;
          }
        }
        // Prefer the iframe whose document top is nearest the screen (continuous stack).
        var best = null;
        var bestScore = Infinity;
        for (var j = 0; j < list.length; j++) {
          var cj = list[j];
          if (!cj || !cj.document) continue;
          try {
            var body = cj.document.body;
            if (!body) continue;
            var rect = body.getBoundingClientRect();
            var score = Math.abs(rect.top);
            if (score < bestScore) {
              bestScore = score;
              best = cj;
            }
          } catch (e2) {}
        }
        return best || list[0] || null;
      } catch (e) {
        return null;
      }
    }
    /** Element box in the outer WebView viewport (iframe-local rects alone are wrong). */
    function screenBoxForElement(contents, el) {
      var rect = el.getBoundingClientRect();
      var left = rect.left;
      var top = rect.top;
      try {
        var win = contents.document && contents.document.defaultView;
        var frame = win && win.frameElement;
        if (frame && typeof frame.getBoundingClientRect === "function") {
          var fr = frame.getBoundingClientRect();
          left = fr.left + rect.left;
          top = fr.top + rect.top;
        }
      } catch (e) {}
      return {
        left: left,
        top: top,
        right: left + (rect.width || 0),
        bottom: top + (rect.height || 0)
      };
    }
    /**
     * Chapter that owns the reading line (~mid outer viewport).
     * Paginated mode lays later chapters in columns to the RIGHT with similar Y —
     * must require horizontal intersection or «Полезные ссылки» steals the footer
     * while «Падмасана» is on screen.
     */
    function tocHrefFromVisibleHeading(start) {
      try {
        var list = [];
        try {
          list = (rendition.getContents && rendition.getContents()) || [];
        } catch (e0) {
          list = [];
        }
        if ((!list || !list.length) && start) {
          var one = contentsForStart(start);
          if (one) list = [one];
        }
        if (!list || !list.length) return null;
        var viewW = 400;
        var viewH = 600;
        try {
          viewW = window.innerWidth || viewW;
          viewH = window.innerHeight || viewH;
        } catch (e1) {}
        var readingLine = viewH * 0.48;
        var bestHref = null;
        var bestTop = -Infinity;
        for (var ci = 0; ci < list.length; ci++) {
          var contents = list[ci];
          if (!contents || !contents.document) continue;
          var doc = contents.document;
          var file = "";
          try {
            if (contents.section && contents.section.href) file = contents.section.href;
            else if (contents.content && contents.content.href) file = contents.content.href;
          } catch (e2) {}
          if (!file && start && start.href) file = String(start.href).split("#")[0];
          file = String(file || "").split("#")[0];
          if (!file) continue;
          var nodes = doc.querySelectorAll("[id]");
          for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            var id = el.id;
            if (!id) continue;
            var leafHref = tocHrefForId(file, id);
            if (!leafHref) continue;
            var scr = screenBoxForElement(contents, el);
            // Current page only (X) — critical for paginated multi-column.
            var onPage = scr.left < viewW * 0.92 && scr.right > viewW * 0.08;
            if (!onPage) continue;
            if (scr.top <= readingLine && scr.bottom > viewH * 0.02 && scr.top >= bestTop) {
              bestTop = scr.top;
              bestHref = leafHref;
            }
          }
        }
        return bestHref;
      } catch (e) {
        return null;
      }
    }
    /** Last *leaf* TOC entry in this spine file whose start CFI is at/before current location. */
    function tocHrefFromCfi(start) {
      try {
        if (!start || !start.cfi || !book || !book.spine) return null;
        var flat = leafToc();
        var leaf = fileLeaf(start.href);
        var liveDoc = null;
        try {
          var liveContents = contentsForStart(start);
          if (liveContents && liveContents.document) liveDoc = liveContents.document;
        } catch (eLive) {}
        var best = null;
        for (var i = 0; i < flat.length; i++) {
          var ch = flat[i];
          if (!sameFile(ch.href, start.href) && fileLeaf(ch.href) !== leaf) continue;
          try {
            var href = ch.href;
            var hash = href.indexOf("#") >= 0 ? href.split("#")[1] : "";
            var section = book.spine.get(href.split("#")[0])
              || book.spine.get(href)
              || book.spine.get("text/" + leaf)
              || book.spine.get(leaf);
            if (!section || typeof section.cfiFromElement !== "function") continue;
            var doc = section.document || liveDoc;
            if (!doc) continue;
            var el = hash ? doc.getElementById(hash) : doc.body;
            if (!el) continue;
            var chCfi = section.cfiFromElement(el);
            if (!chCfi) continue;
            var cmp = ePub.CFI.prototype.compare(start.cfi, chCfi);
            if (cmp >= 0) best = ch;
          } catch (e1) {}
        }
        return best && best.href ? best.href : null;
      } catch (e2) {
        return null;
      }
    }
    function snippetFromStart(start) {
      try {
        if (!rendition) return null;
        var contents = contentsForStart(start);
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
      if (typeof locIdx === "number" && locIdx < 0) locIdx = null;
      var tocHref = null;
      var tocSource = null;
      // Visible heading first — near EOF, epub.js atEnd is often true while an
      // asana heading (e.g. Падмасана) still owns the mid-screen reading line.
      tocHref = tocHrefFromVisibleHeading(start);
      if (tocHref) tocSource = "visible";
      if (!tocHref) {
        tocHref = tocHrefFromCfi(start);
        if (tocHref) tocSource = "cfi";
      }
      if (!tocHref && atEnd) {
        var leavesEof = leafToc();
        if (leavesEof.length) {
          tocHref = leavesEof[leavesEof.length - 1].href || null;
          tocSource = tocHref ? "eof" : null;
        }
      }
      send({
        type: "hzAnchor",
        cfi: start && start.cfi ? start.cfi : null,
        href: start && start.href ? start.href : null,
        tocHref: tocHref,
        tocSource: tocSource,
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
    tocHref?: string | null;
    tocSource?: "visible" | "cfi" | "eof" | null;
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
  const tocSource =
    data.tocSource === "visible" || data.tocSource === "cfi" || data.tocSource === "eof"
      ? data.tocSource
      : null;
  return {
    cfi: data.cfi ?? null,
    href: data.href ?? null,
    tocHref: data.tocHref ?? null,
    tocSource,
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

function spineFileKey(href: string | null | undefined): string {
  if (!href) return "";
  const noHash = href.split("#")[0] ?? href;
  return noHash.replace(/^.*\//, "").trim().toLowerCase();
}

/**
 * While restoring mid-book, ignore flash-of-start events (0% / loc 0) that wipe chrome + resume %.
 * Always accept real navigation across spine files (search / TOC) — otherwise continuous
 * mode can report location=0 after jump and freeze the footer on the old chapter/page.
 */
export function shouldAcceptAnchor(
  prev: LiveAnchor | null,
  next: LiveAnchor,
  opts?: {
    restoring?: boolean;
    resumePercentage?: number | null;
    seedPercent?: number | null;
    forceAccept?: boolean;
  },
): boolean {
  if (!isUsableAnchor(next)) return false;
  if (opts?.forceAccept) return true;

  const prevFile = spineFileKey(prev?.href);
  const nextFile = spineFileKey(next.href);
  if (prevFile && nextFile && prevFile !== nextFile) {
    return true;
  }

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

function normFrag(frag: string): string {
  const raw = frag.trim();
  if (!raw) return "";
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/** Best TOC label — requires fragment when several chapters share one xhtml. */
export function tocLabelForHref(href: string | null | undefined, toc: TocFlatItem[]): string | null {
  if (!href || !toc.length) return null;
  const file = normFile(href);
  if (!file || file.length < 4) return null;
  const frag = href.includes("#") ? normFrag(href.split("#")[1] ?? "") : "";

  const sameFileItems: TocFlatItem[] = [];
  for (const item of toc) {
    const itemFile = normFile(item.href);
    if (!itemFile) continue;
    const sameFile = itemFile === file || itemFile.endsWith(file) || file.endsWith(itemFile);
    if (!sameFile) continue;
    sameFileItems.push(item);
    if (frag) {
      const itemFrag = item.href.includes("#") ? normFrag(item.href.split("#")[1] ?? "") : "";
      if (itemFrag && (itemFrag === frag || frag.startsWith(itemFrag) || itemFrag.startsWith(frag))) {
        return item.label;
      }
    }
  }
  // One TOC entry for the file → safe. Many chapters in one xhtml without a fragment match → null.
  if (sameFileItems.length === 1) return sameFileItems[0]?.label ?? null;
  return null;
}

function tocIndexForHref(href: string | null | undefined, toc: TocFlatItem[]): number {
  if (!href || !toc.length) return -1;
  const label = tocLabelForHref(href, toc);
  if (!label) return -1;
  return toc.findIndex((item) => item.label === label);
}

/**
 * Dampen only CFI “last chapter in shared xhtml” flashes.
 * Never block visible/eof resolutions, backward corrections, or near-EOF updates
 * (Эпилог / Полезные ссылки share ch012 with asanas — pct is already ~1).
 */
export function stabilizeTocHref(
  prevHref: string | null | undefined,
  nextHref: string | null | undefined,
  chapterToc: TocFlatItem[],
  prevPercentage: number | null | undefined,
  nextPercentage: number | null | undefined,
  opts?: {
    tocSource?: LiveAnchor["tocSource"];
  },
): string | null {
  if (!nextHref) return prevHref ?? null;
  if (!prevHref || !chapterToc.length) return nextHref;
  // Trust DOM heading / explicit EOF leaf — never trust bare atEnd with a stale tocHref.
  if (opts?.tocSource === "visible" || opts?.tocSource === "eof") {
    return nextHref;
  }

  const prevIdx = tocIndexForHref(prevHref, chapterToc);
  const nextIdx = tocIndexForHref(nextHref, chapterToc);
  if (prevIdx < 0 || nextIdx < 0 || nextIdx === prevIdx) return nextHref;
  // Fast scroll / undo a wrong lock — always allow moving to an earlier chapter.
  if (nextIdx < prevIdx) return nextHref;

  const nextPct = typeof nextPercentage === "number" ? nextPercentage : null;
  const prevPct = typeof prevPercentage === "number" ? prevPercentage : null;
  if (nextPct != null && nextPct >= 0.97) return nextHref;

  // Same spine file only: CFI briefly reports past a later heading (гл. 7 → 13).
  if (normFile(prevHref) !== normFile(nextHref)) return nextHref;
  if (nextIdx - prevIdx < 3) return nextHref;
  if (prevPct == null || nextPct == null) return nextHref;
  if (Math.abs(nextPct - prevPct) < 0.03 && opts?.tocSource === "cfi") {
    return prevHref;
  }
  return nextHref;
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
    (x.tocHref && x.tocHref.includes("#") ? 3 : 0) +
    (typeof x.percentage === "number" && x.percentage > 0.002 ? 2 : 0) +
    (typeof x.location === "number" && x.location > 0 ? 1 : 0) +
    (x.cfi ? 1 : 0);
  return score(b) > score(a) ? b : a;
}
