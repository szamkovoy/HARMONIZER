import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeSeedPercent,
  pageIndexFromAnchor,
  progressRatioFromAnchor,
  shouldAcceptAnchor,
  tocLabelForHref,
  type LiveAnchor,
} from "./liveAnchor";

describe("tocLabelForHref", () => {
  const toc = [
    { href: "text/ch2.xhtml", label: "2. Уттанасана", depth: 0 },
    { href: "text/afterword.xhtml", label: "Послесловие", depth: 0 },
    { href: "text/links.xhtml", label: "Полезные ссылки", depth: 0 },
  ];

  it("matches by spine file", () => {
    assert.equal(tocLabelForHref("text/afterword.xhtml", toc), "Послесловие");
    assert.equal(tocLabelForHref("OEBPS/text/ch2.xhtml#x", toc), "2. Уттанасана");
  });

  it("does not match empty or tiny hrefs to last TOC entry", () => {
    assert.equal(tocLabelForHref("#frag", toc), null);
    assert.equal(tocLabelForHref("", toc), null);
    assert.equal(tocLabelForHref(null, toc), null);
  });
});

describe("pageIndexFromAnchor", () => {
  it("returns total at EOF", () => {
    const anchor: LiveAnchor = {
      cfi: "epubcfi(x)",
      href: "text/links.xhtml",
      location: 150,
      percentage: 0.999,
      atEnd: true,
      snippet: null,
    };
    assert.equal(pageIndexFromAnchor(anchor, 168, 150), 168);
  });

  it("prefers seed over zeroish location flash", () => {
    const flash: LiveAnchor = {
      cfi: "epubcfi(x)",
      href: "text/links.xhtml",
      location: 0,
      percentage: 0,
      atEnd: false,
      snippet: null,
    };
    assert.equal(pageIndexFromAnchor(flash, 168, 0, 90), 151);
  });

  it("uses seed percent when location is not ready", () => {
    assert.equal(pageIndexFromAnchor(null, 168, null, 90), 151);
  });
});

describe("normalizeSeedPercent", () => {
  it("drops corrupt near-zero saves", () => {
    assert.equal(normalizeSeedPercent(0), null);
    assert.equal(normalizeSeedPercent(0.5), null);
    assert.equal(normalizeSeedPercent(90), 90);
  });
});

describe("progressRatioFromAnchor", () => {
  it("prefers percentage over location index", () => {
    const anchor: LiveAnchor = {
      cfi: "epubcfi(x)",
      href: "text/afterword.xhtml",
      location: 10,
      percentage: 0.92,
      atEnd: false,
      snippet: null,
    };
    assert.equal(progressRatioFromAnchor(anchor, 168, 10), 0.92);
  });
});

describe("shouldAcceptAnchor", () => {
  const mid: LiveAnchor = {
    cfi: "epubcfi(mid)",
    href: "text/ch2.xhtml",
    location: 80,
    percentage: 0.5,
    atEnd: false,
    snippet: "Встаньте прямо",
  };
  const flashStart: LiveAnchor = {
    cfi: "epubcfi(start)",
    href: "text/cover.xhtml",
    location: 0,
    percentage: 0,
    atEnd: false,
    snippet: null,
  };

  it("rejects start flash when seed says mid-book", () => {
    assert.equal(
      shouldAcceptAnchor(null, flashStart, { restoring: true, seedPercent: 55 }),
      false,
    );
  });

  it("accepts mid-book anchor while restoring", () => {
    assert.equal(
      shouldAcceptAnchor(null, mid, { restoring: true, resumePercentage: 0.55 }),
      true,
    );
  });
});
