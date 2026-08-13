import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chapterTocItems,
  flattenToc,
  isChapterFooterLabel,
  isPartTocLabel,
} from "./flattenToc";

describe("flattenToc / chapterTocItems", () => {
  const toc = [
    {
      label: "Оглавление",
      href: "text/toc.xhtml",
      subitems: [{ label: "Пролог", href: "text/ch001.xhtml#пролог" }],
    },
    {
      label: "Часть I: Вход",
      href: "text/ch002.xhtml#часть-i-вход",
      subitems: [
        { label: "1. Первая глава", href: "text/ch002.xhtml#первая" },
        { label: "2. Вторая глава", href: "text/ch002.xhtml#вторая" },
      ],
    },
    {
      label: "Практикум",
      href: "text/ch012.xhtml#практикум",
      subitems: [
        { label: "Эпилог", href: "text/ch012.xhtml#эпилог" },
        { label: "Полезные ссылки", href: "text/ch012.xhtml#ссылки" },
      ],
    },
  ];

  it("marks parents non-leaf and keeps children as leaves", () => {
    const flat = flattenToc(toc);
    const part = flat.find((i) => i.label.startsWith("Часть I"));
    const ch1 = flat.find((i) => i.label.startsWith("1."));
    const prakt = flat.find((i) => i.label === "Практикум");
    const ep = flat.find((i) => i.label === "Эпилог");
    assert.equal(part?.isLeaf, false);
    assert.equal(ch1?.isLeaf, true);
    assert.equal(prakt?.isLeaf, false);
    assert.equal(ep?.isLeaf, true);
  });

  it("chapterTocItems excludes parts and parents", () => {
    const chapters = chapterTocItems(flattenToc(toc));
    const labels = chapters.map((c) => c.label);
    assert.deepEqual(labels, ["Пролог", "1. Первая глава", "2. Вторая глава", "Эпилог", "Полезные ссылки"]);
  });
});

describe("isPartTocLabel / isChapterFooterLabel", () => {
  it("detects part headings", () => {
    assert.equal(isPartTocLabel("Часть I: Вход"), true);
    assert.equal(isPartTocLabel("Part II"), true);
    assert.equal(isPartTocLabel("7. Три гуны"), false);
  });

  it("rejects workshop parent as footer seed", () => {
    assert.equal(isChapterFooterLabel("Практикум"), false);
    assert.equal(isChapterFooterLabel("Эпилог"), true);
    assert.equal(isChapterFooterLabel("13. Этика"), true);
  });
});
