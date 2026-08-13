import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeSeedPercent,
  pageIndexFromAnchor,
  progressRatioFromAnchor,
  shouldAcceptAnchor,
  stabilizeTocHref,
  tocLabelForHref,
  type LiveAnchor,
} from "./liveAnchor";

describe("tocLabelForHref", () => {
  const toc = [
    { href: "text/ch2.xhtml", label: "2. Уттанасана", depth: 0, isLeaf: true },
    {
      href: "text/ch003.xhtml#три-вездесущие-гуны",
      label: "7. Три вездесущие гуны",
      depth: 0,
      isLeaf: true,
    },
    {
      href: "text/ch003.xhtml#этика-и-потоки-энергий",
      label: "13. Этика и потоки энергий",
      depth: 0,
      isLeaf: true,
    },
    { href: "text/afterword.xhtml", label: "Послесловие", depth: 0, isLeaf: true },
  ];

  it("matches by spine file when unique", () => {
    assert.equal(tocLabelForHref("text/afterword.xhtml", toc), "Послесловие");
    assert.equal(tocLabelForHref("OEBPS/text/ch2.xhtml#x", toc), "2. Уттанасана");
  });

  it("matches fragment inside shared xhtml (not last chapter)", () => {
    assert.equal(
      tocLabelForHref("text/ch003.xhtml#три-вездесущие-гуны", toc),
      "7. Три вездесущие гуны",
    );
  });

  it("does not guess last chapter when href has no fragment", () => {
    assert.equal(tocLabelForHref("text/ch003.xhtml", toc), null);
  });

  it("does not match empty or tiny hrefs", () => {
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
      tocHref: null,
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
      tocHref: null,
      location: 0,
      percentage: 0,
      atEnd: false,
      snippet: null,
    };
    assert.equal(pageIndexFromAnchor(flash, 168, 0, 90), 151);
  });
});

describe("normalizeSeedPercent", () => {
  it("drops corrupt near-zero saves", () => {
    assert.equal(normalizeSeedPercent(0), null);
    assert.equal(normalizeSeedPercent(90), 90);
  });
});

describe("progressRatioFromAnchor", () => {
  it("prefers percentage over location index", () => {
    const anchor: LiveAnchor = {
      cfi: "epubcfi(x)",
      href: "text/afterword.xhtml",
      tocHref: null,
      location: 10,
      percentage: 0.92,
      atEnd: false,
      snippet: null,
    };
    assert.equal(progressRatioFromAnchor(anchor, 168, 10), 0.92);
  });
});

describe("stabilizeTocHref", () => {
  const chapters = [
    {
      href: "text/ch003.xhtml#три-вездесущие-гуны",
      label: "7. Три вездесущие гуны",
      depth: 1,
      isLeaf: true,
    },
    {
      href: "text/ch003.xhtml#восьмая",
      label: "8. Восьмая",
      depth: 1,
      isLeaf: true,
    },
    {
      href: "text/ch003.xhtml#девятая",
      label: "9. Девятая",
      depth: 1,
      isLeaf: true,
    },
    {
      href: "text/ch003.xhtml#этика-и-потоки-энергий",
      label: "13. Этика и потоки энергий",
      depth: 1,
      isLeaf: true,
    },
    {
      href: "text/ch012.xhtml#урдхва-дханурасана-поза-перевёрнутого-лука",
      label: "21. Урдхва Дханурасана",
      depth: 1,
      isLeaf: true,
    },
    {
      href: "text/ch012.xhtml#эпилог",
      label: "Эпилог",
      depth: 1,
      isLeaf: true,
    },
    {
      href: "text/ch012.xhtml#полезные-ссылки",
      label: "Полезные ссылки",
      depth: 1,
      isLeaf: true,
    },
  ];

  it("damps CFI flash to last chapter in same file", () => {
    assert.equal(
      stabilizeTocHref(chapters[0].href, chapters[3].href, chapters, 0.12, 0.13, {
        tocSource: "cfi",
      }),
      chapters[0].href,
    );
  });

  it("trusts visible heading even on large jump", () => {
    assert.equal(
      stabilizeTocHref(chapters[0].href, chapters[3].href, chapters, 0.12, 0.13, {
        tocSource: "visible",
      }),
      chapters[3].href,
    );
  });

  it("allows EOF chapter change with tiny pct delta", () => {
    assert.equal(
      stabilizeTocHref(chapters[4].href, chapters[6].href, chapters, 0.995, 0.999, {
        tocSource: "eof",
      }),
      chapters[6].href,
    );
  });

  it("does not keep a CFI flash when pct is already near end", () => {
    assert.equal(
      stabilizeTocHref(chapters[4].href, chapters[6].href, chapters, 0.995, 0.999, {
        tocSource: "cfi",
      }),
      chapters[6].href,
    );
  });

  it("allows backward correction after a wrong lock", () => {
    assert.equal(
      stabilizeTocHref(chapters[3].href, chapters[0].href, chapters, 0.2, 0.19, {
        tocSource: "cfi",
      }),
      chapters[0].href,
    );
  });
});

describe("shouldAcceptAnchor", () => {
  const mid: LiveAnchor = {
    cfi: "epubcfi(mid)",
    href: "text/ch2.xhtml",
    tocHref: "text/ch2.xhtml#x",
    location: 80,
    percentage: 0.5,
    atEnd: false,
    snippet: "Встаньте прямо",
  };
  const flashStart: LiveAnchor = {
    cfi: "epubcfi(start)",
    href: "text/cover.xhtml",
    tocHref: null,
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

  it("accepts spine-file jump even when next looks like start (search/TOC)", () => {
    const afterSearch: LiveAnchor = {
      ...flashStart,
      cfi: "epubcfi(ch2)",
      href: "text/ch002.xhtml",
      location: 0,
      percentage: 0,
    };
    assert.equal(
      shouldAcceptAnchor(mid, afterSearch, { seedPercent: 55 }),
      true,
    );
  });

  it("forceAccept bypasses start-flash guard", () => {
    assert.equal(
      shouldAcceptAnchor(mid, flashStart, { seedPercent: 55, forceAccept: true }),
      true,
    );
  });
});
