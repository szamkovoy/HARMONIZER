/** Build candidate hrefs for epub.js `rendition.display` (path + fragment variants). */
export function tocHrefCandidates(href: string): string[] {
  const raw = (href ?? "").trim();
  if (!raw) return [];

  const out: string[] = [];
  const push = (value: string) => {
    const v = value.trim();
    if (v && !out.includes(v)) out.push(v);
  };

  const hashIdx = raw.indexOf("#");
  const filePart = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
  const frag = hashIdx >= 0 ? raw.slice(hashIdx + 1) : "";

  const fileVariants = (file: string): string[] => {
    if (!file) return [];
    const list: string[] = [];
    const add = (v: string) => {
      if (v && !list.includes(v)) list.push(v);
    };
    add(file);
    try {
      add(decodeURIComponent(file));
    } catch {
      /* ignore */
    }
    if (file.startsWith("text/")) add(file.slice("text/".length));
    if (!file.startsWith("text/") && file.includes(".xhtml")) add(`text/${file}`);
    add(file.replace(/^\/+/, ""));
    add(file.replace(/^.*\//, ""));
    return list;
  };

  const fragVariants = (f: string): string[] => {
    if (!f) return [];
    const list: string[] = [];
    const add = (v: string) => {
      if (v && !list.includes(v)) list.push(v);
    };
    add(f);
    try {
      add(decodeURIComponent(f));
    } catch {
      /* ignore */
    }
    try {
      add(encodeURIComponent(f));
    } catch {
      /* ignore */
    }
    // encodeURIComponent encodes Cyrillic; some builds keep raw Unicode in the id.
    return list;
  };

  // Prefer file#fragment — never bare "#frag" (resolves in the *current* spine item
  // and jumps to Пролог / previous part when the id is missing there).
  if (frag) {
    for (const file of fileVariants(filePart)) {
      for (const f of fragVariants(frag)) {
        push(`${file}#${f}`);
      }
    }
  }
  for (const file of fileVariants(filePart || raw)) {
    push(file);
  }

  return out;
}

export type TocNavigateOptions = {
  /**
   * Desired distance from the top of the WebView to the chapter heading (px).
   * Clears the absolute chrome overlay (~top bar + a few lines of prior text).
   */
  anchorOffsetPx?: number;
};

/**
 * JS: display TOC href, then nudge so the heading sits ~offsetPx from the top
 * (not under the chrome, not stuck at the bottom of a paginated page).
 */
export function buildTocNavigateScript(href: string, opts?: TocNavigateOptions): string {
  const candidates = tocHrefCandidates(href);
  const offsetPx = Math.max(48, Math.round(opts?.anchorOffsetPx ?? 110));
  const frag = href.includes("#") ? href.slice(href.indexOf("#") + 1) : "";
  const fileHint = href.includes("#")
    ? href.slice(0, href.indexOf("#"))
    : href;

  return `
    (function () {
      var hrefs = ${JSON.stringify(candidates)};
      var offsetPx = ${offsetPx};
      var wantFrag = ${JSON.stringify(frag)};
      var fileHint = ${JSON.stringify(fileHint)};
      function normFrag(f) {
        var raw = String(f || "").trim();
        if (!raw) return "";
        try { return decodeURIComponent(raw).toLowerCase(); } catch (e) { return raw.toLowerCase(); }
      }
      function fileLeaf(h) {
        var noHash = String(h || "").split("#")[0];
        var parts = noHash.split("/");
        return (parts[parts.length - 1] || noHash).toLowerCase();
      }
      var want = normFrag(wantFrag);
      var wantFile = fileLeaf(fileHint);
      function screenTop(el, contents) {
        var rect = el.getBoundingClientRect();
        var top = rect.top;
        try {
          var win = contents.document && contents.document.defaultView;
          var frame = win && win.frameElement;
          if (frame && typeof frame.getBoundingClientRect === "function") {
            top = frame.getBoundingClientRect().top + rect.top;
          }
        } catch (e) {}
        return top;
      }
      function contentsFile(contents) {
        try {
          if (contents.section && contents.section.href) return fileLeaf(contents.section.href);
          if (contents.content && contents.content.href) return fileLeaf(contents.content.href);
        } catch (e) {}
        return "";
      }
      /** Only the element for this TOC href — never the first h1 in another loaded iframe. */
      function findTarget() {
        try {
          if (!want) return null;
          var list = rendition.getContents && rendition.getContents();
          if (!list || !list.length) return null;
          for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (!c || !c.document) continue;
            if (wantFile) {
              var cf = contentsFile(c);
              if (cf && cf !== wantFile && cf.indexOf(wantFile) < 0 && wantFile.indexOf(cf) < 0) {
                continue;
              }
            }
            var el = null;
            try { el = c.document.getElementById(wantFrag); } catch (e0) {}
            if (!el) {
              try {
                el = c.document.getElementById(decodeURIComponent(wantFrag));
              } catch (e1) {}
            }
            if (!el) {
              var nodes = c.document.querySelectorAll("[id]");
              for (var n = 0; n < nodes.length; n++) {
                if (normFrag(nodes[n].id) === want) { el = nodes[n]; break; }
              }
            }
            if (el) return { el: el, contents: c };
          }
        } catch (e3) {}
        return null;
      }
      function axisVertical() {
        try {
          var mgr = rendition.manager;
          if (!mgr) return false;
          if (mgr.settings && mgr.settings.axis === "vertical") return true;
          var flow = "";
          try { flow = String(rendition.settings && rendition.settings.flow || ""); } catch (e) {}
          return flow.indexOf("scrolled") >= 0;
        } catch (e3) {
          return false;
        }
      }
      function placeHeading(attempt) {
        var hit = findTarget();
        if (!hit) return;
        var viewH = window.innerHeight || 600;
        var targetY = Math.min(Math.max(offsetPx, viewH * 0.12), viewH * 0.4);
        var top = screenTop(hit.el, hit.contents);
        var delta = top - targetY;
        var mgr = rendition.manager;
        if (!mgr || typeof mgr.scrollBy !== "function") return;

        if (axisVertical()) {
          if (Math.abs(delta) > 10) {
            try { mgr.scrollBy(0, delta, true); } catch (e4) {}
          }
          return;
        }

        // Paginated: heading stuck near the bottom → advance until it rises.
        if (top > viewH * 0.45 && attempt < 8) {
          try {
            var step = (mgr.layout && mgr.layout.delta) || (window.innerWidth || 320);
            mgr.scrollBy(step, 0, true);
          } catch (e5) {}
          setTimeout(function () { placeHeading(attempt + 1); }, 100);
          return;
        }
        if (Math.abs(delta) > 12 && top < viewH * 0.5) {
          try { mgr.scrollBy(0, delta, true); } catch (e6) {}
        }
      }
      function afterDisplay() {
        setTimeout(function () { placeHeading(0); }, 80);
        setTimeout(function () { placeHeading(0); }, 280);
        setTimeout(function () { placeHeading(0); }, 560);
      }
      function go(i) {
        if (i >= hrefs.length) return;
        try {
          var p = rendition.display(hrefs[i]);
          if (p && typeof p.then === "function") {
            p.then(function () { afterDisplay(); }).catch(function () { go(i + 1); });
          } else {
            afterDisplay();
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
