/**
 * Continuously scrolled epub.js sizes each spine iframe from content height.
 * Cover CSS uses `100vh` / `min-height: 100%`, which collapses to ~0 inside that
 * iframe — paginated forces a full viewport so the cover still shows.
 * Pin the cover stage to the reader size and stretch the image to full width
 * (matching paginated cover), then re-expand after the image loads.
 */
export function buildEnsureCoverStageScript(heightPx: number, widthPx?: number): string {
  const h = Math.max(220, Math.round(heightPx));
  const w = Math.max(160, Math.round(widthPx ?? 0));
  return `
    (function () {
      var H = ${h};
      var W = ${w};
      function fixCover(contents) {
        try {
          if (!contents || !contents.document) return;
          var body = contents.document.body;
          if (!body || String(body.id || "").toLowerCase() !== "cover") return;
          body.style.margin = "0";
          body.style.padding = "0";
          body.style.boxSizing = "border-box";
          body.style.display = "flex";
          body.style.alignItems = "center";
          body.style.justifyContent = "center";
          body.style.width = "100%";
          body.style.minHeight = H + "px";
          body.style.height = H + "px";
          var wrap = contents.document.getElementById("cover-image");
          if (wrap) {
            wrap.style.width = "100%";
            wrap.style.maxWidth = "100%";
            wrap.style.maxHeight = H + "px";
            wrap.style.display = "flex";
            wrap.style.alignItems = "center";
            wrap.style.justifyContent = "center";
            wrap.style.margin = "0";
            wrap.style.padding = "0";
          }
          var img = contents.document.querySelector("#cover-image img, #cover-image svg, body#cover img");
          if (img) {
            // Override epub img width:auto !important — full width like paginated.
            var imgW = W > 0 ? W + "px" : "100%";
            img.style.setProperty("width", imgW, "important");
            img.style.setProperty("max-width", "100%", "important");
            img.style.setProperty("min-width", "0", "important");
            img.style.setProperty("height", "auto", "important");
            img.style.setProperty("max-height", Math.floor(H * 0.96) + "px", "important");
            img.style.setProperty("min-height", "0", "important");
            img.style.setProperty("object-fit", "contain", "important");
            img.style.setProperty("margin", "0", "important");
            img.style.setProperty("display", "block", "important");
            if (!img.getAttribute("data-hz-cover-bound")) {
              img.setAttribute("data-hz-cover-bound", "1");
              img.addEventListener("load", function () {
                try {
                  if (typeof contents.expand === "function") contents.expand();
                  if (rendition && rendition.manager && typeof rendition.manager.update === "function") {
                    rendition.manager.update();
                  }
                } catch (e0) {}
              });
            }
          }
          try {
            if (typeof contents.expand === "function") contents.expand();
          } catch (e1) {}
        } catch (e) {}
      }
      function scan() {
        try {
          if (typeof rendition === "undefined" || !rendition) return;
          var list = rendition.getContents && rendition.getContents();
          if (!list) return;
          for (var i = 0; i < list.length; i++) fixCover(list[i]);
        } catch (e2) {}
      }
      try {
        if (
          typeof rendition !== "undefined" &&
          rendition &&
          rendition.hooks &&
          rendition.hooks.content &&
          !window.__hzCoverHook
        ) {
          window.__hzCoverHook = true;
          rendition.hooks.content.register(function (contents) {
            fixCover(contents);
            setTimeout(function () { fixCover(contents); }, 60);
            setTimeout(function () { fixCover(contents); }, 320);
          });
        }
      } catch (e3) {}
      scan();
      setTimeout(scan, 120);
      setTimeout(scan, 450);
      return true;
    })();
    true;
  `;
}
