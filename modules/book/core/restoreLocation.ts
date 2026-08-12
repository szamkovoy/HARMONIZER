/**
 * JS injected after font/theme changes to keep reading focus.
 * Prefers book percentage (stable across reflow); CFI is fallback only.
 * `token` cancels older restores when the user changes prefs again quickly.
 */
export function buildRestoreLocationScript(opts: {
  cfi: string | null;
  /** 0..1 book progress at visual center of the current page */
  percentage: number | null;
  token: number;
}): string {
  const cfi = opts.cfi;
  const pct =
    typeof opts.percentage === "number" && Number.isFinite(opts.percentage)
      ? Math.min(1, Math.max(0, opts.percentage))
      : null;
  const token = opts.token;

  return `
    (function () {
      var token = ${token};
      window.__hzRestoreToken = token;
      var pct = ${JSON.stringify(pct)};
      var cfi = ${JSON.stringify(cfi)};
      function alive() { return window.__hzRestoreToken === token; }
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
      function byCfi() {
        try {
          if (!alive() || !cfi) return false;
          rendition.display(cfi);
          return true;
        } catch (e) {
          return false;
        }
      }
      function attempt(n) {
        if (!alive()) return;
        // Percentage first — CFI often points at the wrong paragraph after font metrics change.
        if (byPercentage()) return;
        if (n >= 8) {
          byCfi();
          return;
        }
        var ready = book && book.locations && book.locations.length > 0;
        setTimeout(function () { attempt(n + 1); }, ready ? 90 : 160);
      }
      setTimeout(function () { attempt(0); }, 120);
    })();
    true;
  `;
}

/** Midpoint percentage of the visible page (keeps center phrase after reflow). */
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
  if (typeof sp === "number" && Number.isFinite(sp)) return sp;
  const total = typeof totalLocations === "number" ? totalLocations : 0;
  const idx = loc.start.location;
  if (typeof idx === "number" && total > 1) {
    return idx / (total - 1);
  }
  return null;
}
