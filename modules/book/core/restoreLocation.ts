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
  /**
   * Scroll flow remount (paginated ↔ continuous): keep the same on-screen line.
   * Order: start-% → snippet (nearest to CFI in this spine file) → CFI.
   * Never href# (chapter heading) and never first-match snippet alone.
   */
  preferPercentage?: boolean;
}): string {
  const cfi = opts.cfi;
  const pct =
    typeof opts.percentage === "number" && Number.isFinite(opts.percentage)
      ? Math.min(1, Math.max(0, opts.percentage))
      : null;
  const snippet = opts.snippet && opts.snippet.length >= 12 ? opts.snippet : null;
  const href = opts.href;
  const token = opts.token;
  const preferPercentage = !!opts.preferPercentage;

  return `
    (function () {
      var token = ${token};
      window.__hzRestoreToken = token;
      var pct = ${JSON.stringify(pct)};
      var cfi = ${JSON.stringify(cfi)};
      var snippet = ${JSON.stringify(snippet)};
      var hrefHint = ${JSON.stringify(href)};
      var preferPercentage = ${preferPercentage ? "true" : "false"};
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
      function byHref() {
        try {
          if (!alive() || !hrefHint || typeof rendition === "undefined" || !rendition) return false;
          // Fragment href is stable across paginated ↔ continuous managers.
          if (String(hrefHint).indexOf("#") < 0) return false;
          rendition.display(hrefHint);
          return true;
        } catch (e) {
          return false;
        }
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
          var len = 0;
          try {
            len = typeof book.locations.length === "function"
              ? book.locations.length()
              : (book.locations.length || 0);
          } catch (eLen) { len = 0; }
          if (!(len > 1) && typeof book.locations.cfiFromPercentage !== "function") return false;
          var target = null;
          if (typeof book.locations.cfiFromPercentage === "function") {
            target = book.locations.cfiFromPercentage(pct);
          } else if (len > 1) {
            var idx = Math.round(pct * Math.max(0, len - 1));
            target = typeof book.locations.cfiFromLocation === "function"
              ? book.locations.cfiFromLocation(idx)
              : null;
          }
          if (!target) return false;
          rendition.display(target);
          return true;
        } catch (e) {
          return false;
        }
      }
      function byPercentageWithRetry(left, then) {
        if (!alive()) return;
        if (byPercentage()) {
          setTimeout(finishRestore, 220);
          return;
        }
        if (left > 0) {
          setTimeout(function () { byPercentageWithRetry(left - 1, then); }, 280);
          return;
        }
        then();
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
      function pickNearestCfi(matches) {
        if (!matches || !matches.length) return null;
        var first = matches[0] && matches[0].cfi ? matches[0].cfi : null;
        if (!first || !cfi || matches.length === 1) return first;
        var best = first;
        var bestDist = Infinity;
        var targetPct = null;
        try {
          if (book.locations && typeof book.locations.percentageFromCfi === "function") {
            targetPct = book.locations.percentageFromCfi(cfi);
          }
        } catch (ePct) { targetPct = null; }
        if (typeof targetPct !== "number" || !isFinite(targetPct)) {
          if (pct != null) targetPct = pct;
        }
        for (var mi = 0; mi < matches.length; mi++) {
          var mCfi = matches[mi] && matches[mi].cfi;
          if (!mCfi) continue;
          var dist = Infinity;
          try {
            if (typeof targetPct === "number" && book.locations &&
                typeof book.locations.percentageFromCfi === "function") {
              var mp = book.locations.percentageFromCfi(mCfi);
              if (typeof mp === "number" && isFinite(mp)) dist = Math.abs(mp - targetPct);
            } else if (typeof ePub !== "undefined" && ePub.CFI && ePub.CFI.prototype &&
                typeof ePub.CFI.prototype.compare === "function") {
              dist = Math.abs(ePub.CFI.prototype.compare(mCfi, cfi));
            }
          } catch (eDist) { dist = Infinity; }
          if (dist < bestDist) {
            bestDist = dist;
            best = mCfi;
          }
        }
        return best;
      }
      function findInSection(section, needle, done) {
        if (!section) { done(null); return; }
        try {
          section.load(book.load.bind(book)).then(function () {
            try {
              var found = section.find(needle);
              var chosen = pickNearestCfi(found);
              if (chosen) {
                done(chosen);
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
        if (full.length >= 18) needles.push(full.slice(0, 72));
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
        // Flow switch: stay inside the current spine file only — scanning the
        // whole book matches duplicate phrases and jumps many screens away.
        if (!preferPercentage) {
          try {
            var items = [];
            book.spine.each(function (s) { items.push(s); });
            var startIdx = primary ? items.indexOf(primary) : -1;
            if (startIdx < 0 && hrefHint) {
              var leaf = hrefHint.replace(/^.*\\//, "").split("#")[0];
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
        } else if (!sections.length && hrefHint) {
          try {
            var leaf2 = String(hrefHint).replace(/^.*\\//, "").split("#")[0];
            book.spine.each(function (s) {
              if (sections.length) return;
              if (String(s.href || "").indexOf(leaf2) >= 0) sections.push(s);
            });
          } catch (e3b) {}
        }
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
      function byCfiWithRetry(left, then) {
        if (!alive()) return;
        if (byCfi()) {
          setTimeout(finishRestore, 220);
          return;
        }
        if (left > 0) {
          setTimeout(function () { byCfiWithRetry(left - 1, then); }, 240);
          return;
        }
        then();
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
      function fallbackPctThenCfi() {
        if (!alive()) return;
        if (byPercentage()) {
          setTimeout(finishRestore, 220);
          return;
        }
        if (byCfi()) {
          setTimeout(finishRestore, 220);
          return;
        }
        setTimeout(finishRestore, 120);
      }
      // Flow switch: same on-screen line — start-% first (manager-stable), then
      // nearest snippet in this spine file, then CFI. Never href#.
      if (preferPercentage) {
        function afterPct() {
          if (snippet) {
            bySnippet(function (ok) {
              if (!alive()) return;
              if (ok) {
                setTimeout(finishRestore, 180);
                return;
              }
              byCfiWithRetry(8, function () {
                setTimeout(finishRestore, 160);
              });
            });
            return;
          }
          byCfiWithRetry(8, function () {
            setTimeout(finishRestore, 160);
          });
        }
        byPercentageWithRetry(14, afterPct);
        return;
      }
      // Font/size reflow: snippet first — CFI character offsets shift.
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

/** Midpoint percentage of the visible page (chrome / scrub fallback only). */
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

/**
 * Top-of-view percentage — use for paginated↔scrolled remount.
 * Center % of a full page starting at a chapter heading lands mid-chapter.
 */
export function visibleStartPercentage(
  loc: {
    start?: { percentage?: number; location?: number };
  } | null | undefined,
  totalLocations: number | null | undefined,
): number | null {
  if (!loc?.start) return null;
  const sp = loc.start.percentage;
  if (typeof sp === "number" && Number.isFinite(sp) && sp > 0.002) return sp;
  const total = typeof totalLocations === "number" ? totalLocations : 0;
  const idx = loc.start.location;
  if (typeof idx === "number" && idx > 0 && total > 1) {
    return idx / (total - 1);
  }
  return null;
}
