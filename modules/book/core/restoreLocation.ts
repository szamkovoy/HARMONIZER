/**
 * Restore reading focus after theme/font change or remount.
 * Prefer text snippet (stable across reflow), then CFI, then percentage.
 */
export function buildRestoreLocationScript(opts: {
  cfi: string | null;
  percentage: number | null;
  snippet: string | null;
  href: string | null;
  token: number;
}): string {
  const cfi = opts.cfi;
  const pct =
    typeof opts.percentage === "number" && Number.isFinite(opts.percentage)
      ? Math.min(1, Math.max(0, opts.percentage))
      : null;
  const snippet = opts.snippet && opts.snippet.length >= 12 ? opts.snippet : null;
  const href = opts.href;
  const token = opts.token;

  return `
    (function () {
      var token = ${token};
      window.__hzRestoreToken = token;
      var pct = ${JSON.stringify(pct)};
      var cfi = ${JSON.stringify(cfi)};
      var snippet = ${JSON.stringify(snippet)};
      var hrefHint = ${JSON.stringify(href)};
      var finished = false;
      function alive() { return window.__hzRestoreToken === token; }
      function normSpace(s) {
        return String(s || "").replace(/\\s+/g, " ").trim();
      }
      function finishRestore() {
        if (finished || !alive()) return;
        finished = true;
        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: "hzRestoreDone", token: token }));
          }
        } catch (e) {}
      }
      function byCfi() {
        try {
          if (!alive() || !cfi || typeof rendition === "undefined" || !rendition) return false;
          rendition.display(cfi);
          return true;
        } catch (e) {
          return false;
        }
      }
      function byPercentage() {
        try {
          if (!alive() || pct == null || !book || !book.locations) return false;
          var target = null;
          if (typeof book.locations.cfiFromPercentage === "function") {
            target = book.locations.cfiFromPercentage(pct);
          } else if (book.locations.length) {
            var idx = Math.round(pct * Math.max(0, book.locations.length - 1));
            target = book.locations[idx];
          }
          if (!target) return false;
          rendition.display(target);
          return true;
        } catch (e) {
          return false;
        }
      }
      function spineGet(h) {
        if (!h || !book || !book.spine) return null;
        try {
          return book.spine.get(h)
            || book.spine.get(h.replace(/^.*\\//, ""))
            || book.spine.get("text/" + h.replace(/^.*\\//, ""))
            || null;
        } catch (e) { return null; }
      }
      function findInSection(section, needle, done) {
        if (!section) { done(null); return; }
        try {
          section.load(book.load.bind(book)).then(function () {
            try {
              var found = section.find(needle);
              if (found && found.length && found[0] && found[0].cfi) {
                done(found[0].cfi);
                return;
              }
            } catch (e1) {}
            done(null);
          }).catch(function () { done(null); });
        } catch (e2) {
          done(null);
        }
      }
      function bySnippet(done) {
        if (!alive() || !snippet || !book || !book.spine) {
          done(false);
          return;
        }
        var full = normSpace(snippet);
        var needles = [];
        if (full.length >= 12) needles.push(full.slice(0, 56));
        if (full.length >= 24) needles.push(full.slice(0, 32));
        if (full.length >= 40) needles.push(full.slice(0, 20));
        // Prefer a mid-snippet needle (start of page often truncated mid-word).
        if (full.length >= 36) {
          var mid = full.slice(8, 40);
          if (mid.length >= 16) needles.push(mid);
        }
        var sections = [];
        var primary = spineGet(hrefHint);
        if (primary) sections.push(primary);
        try {
          var items = [];
          book.spine.each(function (s) { items.push(s); });
          var startIdx = primary ? items.indexOf(primary) : -1;
          if (startIdx < 0 && hrefHint) {
            var leaf = hrefHint.replace(/^.*\\//, "");
            for (var si = 0; si < items.length; si++) {
              if (String(items[si].href || "").indexOf(leaf) >= 0) { startIdx = si; break; }
            }
          }
          if (startIdx < 0) startIdx = Math.max(0, Math.floor(items.length * (pct != null ? pct : 0.5)) - 1);
          for (var d = 0; d <= 4; d++) {
            var a = startIdx - d;
            var b = startIdx + d;
            if (a >= 0 && a < items.length && sections.indexOf(items[a]) < 0) sections.push(items[a]);
            if (b >= 0 && b < items.length && sections.indexOf(items[b]) < 0) sections.push(items[b]);
          }
        } catch (e3) {}
        var sIdx = 0;
        var nIdx = 0;
        function step() {
          if (!alive()) { done(false); return; }
          if (sIdx >= sections.length) { done(false); return; }
          if (nIdx >= needles.length) {
            nIdx = 0;
            sIdx += 1;
            step();
            return;
          }
          var section = sections[sIdx];
          var needle = needles[nIdx++];
          findInSection(section, needle, function (foundCfi) {
            if (foundCfi) {
              try { rendition.display(foundCfi); done(true); } catch (e4) { done(false); }
              return;
            }
            step();
          });
        }
        step();
      }
      function fallbackCfiThenPct() {
        if (!alive()) return;
        if (byCfi()) {
          setTimeout(finishRestore, 220);
          return;
        }
        byPercentage();
        setTimeout(finishRestore, 220);
      }
      // Snippet first — CFI character offsets shift after font/size reflow.
      if (snippet) {
        bySnippet(function (ok) {
          if (!alive()) return;
          if (ok) {
            setTimeout(finishRestore, 180);
            return;
          }
          fallbackCfiThenPct();
        });
      } else {
        fallbackCfiThenPct();
      }
    })();
    true;
  `;
}

/** Midpoint percentage of the visible page (fallback only). */
export function visibleCenterPercentage(
  loc: {
    start?: { percentage?: number; location?: number };
    end?: { percentage?: number; location?: number };
  } | null | undefined,
  totalLocations: number | null | undefined,
): number | null {
  if (!loc?.start) return null;
  const sp = loc.start.percentage;
  const ep = loc.end?.percentage;
  if (typeof sp === "number" && typeof ep === "number" && Number.isFinite(sp) && Number.isFinite(ep)) {
    return (sp + ep) / 2;
  }
  if (typeof sp === "number" && Number.isFinite(sp) && sp > 0.002) return sp;
  const total = typeof totalLocations === "number" ? totalLocations : 0;
  const idx = loc.start.location;
  if (typeof idx === "number" && idx > 0 && total > 1) {
    return idx / (total - 1);
  }
  return null;
}
