/** Build candidate hrefs for epub.js `rendition.display` (path + fragment variants). */
export function tocHrefCandidates(href: string): string[] {
  const raw = (href ?? "").trim();
  if (!raw) return [];

  const out: string[] = [];
  const push = (value: string) => {
    const v = value.trim();
    if (v && !out.includes(v)) out.push(v);
  };

  push(raw);
  try {
    push(decodeURIComponent(raw));
  } catch {
    /* ignore */
  }

  if (raw.startsWith("text/")) push(raw.slice("text/".length));
  if (!raw.startsWith("text/") && raw.includes(".xhtml")) push(`text/${raw}`);

  push(raw.replace(/^\/+/, ""));
  push(raw.replace(/^.*\//, ""));

  const hashIdx = raw.indexOf("#");
  if (hashIdx >= 0) {
    const file = raw.slice(0, hashIdx);
    const frag = raw.slice(hashIdx + 1);
    push(file);
    if (file.startsWith("text/")) push(file.slice("text/".length));
    if (frag) {
      push(`#${frag}`);
      try {
        push(`#${decodeURIComponent(frag)}`);
      } catch {
        /* ignore */
      }
    }
  }

  return out;
}

/** Post live CFI/href/% after navigation so RN chrome does not stay on a stale chapter. */
const POST_LIVE_ANCHOR_JS = `
  function hzPostLiveAnchor() {
    try {
      if (typeof rendition === "undefined" || !rendition) return;
      var loc = rendition.currentLocation();
      var start = loc && loc.start ? loc.start : null;
      var end = loc && loc.end ? loc.end : null;
      var pct = null;
      if (start && typeof start.percentage === "number") {
        pct = end && typeof end.percentage === "number"
          ? (start.percentage + end.percentage) / 2
          : start.percentage;
      }
      if (pct == null && start && start.cfi && book && book.locations && typeof book.locations.percentageFromCfi === "function") {
        try { pct = book.locations.percentageFromCfi(start.cfi); } catch (e) {}
      }
      var atEnd = !!(loc && loc.atEnd);
      if (!atEnd && typeof pct === "number" && pct >= 0.995) atEnd = true;
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: "hzAnchor",
          cfi: start && start.cfi ? start.cfi : null,
          href: start && start.href ? start.href : null,
          location: start && typeof start.location === "number" ? start.location : null,
          percentage: typeof pct === "number" ? pct : null,
          atEnd: atEnd
        }));
      }
    } catch (err) {}
  }
`;

/** JS snippet: try candidates until display() succeeds; then sync live anchor. */
export function buildTocNavigateScript(href: string): string {
  const candidates = tocHrefCandidates(href);
  return `
    (function () {
      ${POST_LIVE_ANCHOR_JS}
      var hrefs = ${JSON.stringify(candidates)};
      function go(i) {
        if (i >= hrefs.length) return;
        try {
          var p = rendition.display(hrefs[i]);
          if (p && typeof p.then === "function") {
            p.then(function () {
              setTimeout(hzPostLiveAnchor, 40);
              setTimeout(hzPostLiveAnchor, 220);
            }).catch(function () { go(i + 1); });
          } else {
            setTimeout(hzPostLiveAnchor, 40);
          }
        } catch (e) {
          go(i + 1);
        }
      }
      go(0);
    })();
    true;
  `;
}

/**
 * Fallback tap bridge for scrolled-doc (native overlay is used in paginated mode).
 * Binds iframe documents via content hook so clicks survive chapter changes.
 */
export const TAP_ZONE_BRIDGE_JS = `
  (function () {
    var last = 0;
    function send(zone) {
      var now = Date.now();
      if (now - last < 300) return;
      last = now;
      try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: "tapZone", zone: zone }));
        }
      } catch (err) {}
    }
    function zoneFromX(x, width) {
      var ratio = x / Math.max(1, width);
      if (ratio < 0.28) return "left";
      if (ratio > 0.72) return "right";
      return "center";
    }
    function bindDoc(doc) {
      if (!doc || doc.documentElement && doc.documentElement.getAttribute("data-hz-tap") === "1") return;
      try {
        if (doc.documentElement) doc.documentElement.setAttribute("data-hz-tap", "1");
      } catch (e) {}
      doc.addEventListener("click", function (e) {
        var w = (doc.documentElement && doc.documentElement.clientWidth) || 1;
        var x = typeof e.clientX === "number" ? e.clientX : 0;
        send(zoneFromX(x, w));
      }, true);
    }
    try {
      if (typeof rendition !== "undefined" && rendition) {
        if (rendition.hooks && rendition.hooks.content && rendition.hooks.content.register) {
          rendition.hooks.content.register(function (contents) {
            try { bindDoc(contents.document); } catch (e) {}
          });
        }
        if (typeof rendition.getContents === "function") {
          var list = rendition.getContents();
          if (list && typeof list.forEach === "function") {
            list.forEach(function (c) { try { bindDoc(c.document); } catch (e) {} });
          }
        }
        rendition.on("click", function (e, contents) {
          var doc = contents && contents.document ? contents.document : document;
          var w = (doc.documentElement && doc.documentElement.clientWidth) || window.innerWidth || 1;
          var x = e && typeof e.clientX === "number" ? e.clientX : w / 2;
          send(zoneFromX(x, w));
        });
      }
    } catch (err) {}
  })();
  true;
`;
