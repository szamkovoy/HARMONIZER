import type { ColorTokens } from "@/modules/ui/theme";

import { FONT_FAMILY_CSS, type ReaderPrefs } from "./readerPrefs";

/** Pure white / near-black page so JPEG/PNG white boxes blend into the page. */
export function buildReaderTheme(colors: ColorTokens, prefs: ReaderPrefs, scheme: "light" | "dark") {
  const pageBg = scheme === "dark" ? "#121212" : "#ffffff";
  const ink = scheme === "dark" ? "#f2f2f2" : "#1a1a1a";
  const muted = scheme === "dark" ? "#c8c8c8" : "#333333";
  const heading = scheme === "dark" ? "#ffffff" : "#121826";
  const link = colors.accent;

  return {
    body: {
      background: pageBg,
      color: `${ink} !important`,
      "font-family": FONT_FAMILY_CSS[prefs.fontFamily],
      "font-size": `${prefs.fontSizePx}px`,
      "line-height": String(prefs.lineHeight),
      // Side gaps come from RN WebView inset (same for paginated + scrolled).
      // HTML horizontal padding clips epub.js columns and was unreliable in continuous.
      "padding-left": "0",
      "padding-right": "0",
    },
    html: {
      background: pageBg,
    },
    span: { color: `${ink} !important` },
    p: { color: `${ink} !important` },
    li: { color: `${ink} !important` },
    h1: { color: `${heading} !important` },
    h2: { color: `${heading} !important` },
    h3: { color: `${heading} !important` },
    a: {
      color: `${link} !important`,
      "pointer-events": "auto",
      cursor: "pointer",
    },
    blockquote: {
      "font-style": "italic",
      color: `${muted} !important`,
      "margin-left": "2px",
    },
    "blockquote p": {
      "font-style": "italic",
      color: `${muted} !important`,
    },
    "p:has(> img) + blockquote": {
      "margin-top": "calc(0.35em + 3px)",
    },
    img: {
      background: pageBg,
    },
    // Cover: avoid min-height:100% (collapses in scrolled-continuous iframes).
    // Scrolled mode also pins px height via buildEnsureCoverStageScript.
    "body#cover": {
      margin: "0 !important",
      padding: "0 !important",
      height: "100vh",
      "min-height": "100vh",
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      "box-sizing": "border-box",
    },
    "#cover-image": {
      width: "100%",
      "max-height": "90vh",
      "min-height": "50vh",
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
    },
    "#cover-image svg, #cover-image img": {
      width: "100%",
      "max-width": "100%",
      "max-height": "96vh",
      height: "auto",
      "object-fit": "contain",
    },
    "::selection": { background: colors.accent },
  };
}
