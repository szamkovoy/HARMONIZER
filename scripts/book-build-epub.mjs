/**
 * Build EPUB 3 from Book/*.docx (local pipeline; no deploy).
 *
 *   node scripts/book-build-epub.mjs ru
 *   node scripts/book-build-epub.mjs en
 *
 * Requires: pandoc + unzip/zip on PATH.
 * Copies result to assets/books/ for Expo Asset bundling (Phase A).
 */
import { execFileSync } from "child_process";
import {
  copyFileSync,
  mkdirSync,
  existsSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const locale = (process.argv[2] || "ru").toLowerCase();

const SOURCES = {
  ru: {
    docx: "Book_Ru.docx",
    cover: "cover_Ru.jpg",
    title: "Йога — путь волшебника",
    author: "Сергей Замковой",
    lang: "ru",
    asset: "yoga-wizards-path-ru.epub",
  },
  en: {
    docx: "Book_En.docx",
    cover: "cover_En.jpg",
    title: "Yoga — the Way of Wisdom",
    author: "Sergei Zamkovoi",
    lang: "en",
    asset: "yoga-wizards-path-en.epub",
  },
};

const cfg = SOURCES[locale];
if (!cfg) {
  console.error("Usage: node scripts/book-build-epub.mjs ru|en");
  process.exit(1);
}

const bookDir = join(root, "Book");
const docx = join(bookDir, cfg.docx);
const cover = join(bookDir, cfg.cover);
const css = join(bookDir, "epub-reader.css");
const outDir = join(bookDir, "build", locale);
const outEpub = join(outDir, "book.epub");
const assetDir = join(root, "assets", "books");
const assetPath = join(assetDir, cfg.asset);

if (!existsSync(docx)) {
  console.error("Missing", docx);
  process.exit(1);
}
if (!existsSync(cover)) {
  console.error("Missing", cover);
  process.exit(1);
}
if (!existsSync(css)) {
  console.error("Missing", css);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
mkdirSync(assetDir, { recursive: true });

console.log("pandoc", locale, "…");
// No --toc: Word already contains a TOC chapter; pandoc still builds nav.xhtml from headings.
execFileSync(
  "pandoc",
  [
    docx,
    "-o",
    outEpub,
    "-t",
    "epub3",
    `--css=${css}`,
    `--epub-cover-image=${cover}`,
    `--metadata=title:${cfg.title}`,
    `--metadata=author:${cfg.author}`,
    `--metadata=lang:${cfg.lang}`,
  ],
  { stdio: "inherit" },
);

console.log("post-process EPUB…");
const work = mkdtempSync(join(tmpdir(), "harmonizer-epub-"));
try {
  execFileSync("unzip", ["-q", outEpub, "-d", work], { stdio: "inherit" });

  // Keep nav/title for package metadata, but exclude from linear reading order.
  // title_page is nearly blank in paginated mode (looks like an empty swipe).
  const opfPath = join(work, "EPUB", "content.opf");
  let opf = readFileSync(opfPath, "utf8");
  opf = opf.replace(
    /<itemref\s+idref="nav"\s*\/>/g,
    '<itemref idref="nav" linear="no" />',
  );
  opf = opf.replace(
    /<itemref\s+idref="title_page_xhtml"[^/]*\/>/g,
    '<itemref idref="title_page_xhtml" linear="no" />',
  );
  writeFileSync(opfPath, opf);

  // Strip Word-embedded "Оглавление" block from ch001; keep Пролог and the rest.
  const ch001Path = join(work, "EPUB", "text", "ch001.xhtml");
  if (existsSync(ch001Path)) {
    let html = readFileSync(ch001Path, "utf8");
    html = html.replace(
      /<section[^>]*id="оглавление"[^>]*>[\s\S]*?<\/section>\s*/u,
      "",
    );
    // Drop empty auto-heading leftovers that produce blank TOC entries.
    html = html.replace(/<section[^>]*id="section"[^>]*>\s*<\/section>/gu, "");
    // Prefer fluid images over fixed Word inches.
    html = html.replace(/\sstyle="width:[^"]*"/g, "");
    // Collapse accidental double wrappers left after TOC strip.
    html = html.replace(/<\/section>\s*<\/section>\s*<\/body>/u, "</section>\n</body>");
    writeFileSync(ch001Path, html);
  }

  // Same image style cleanup for other chapters.
  const textDir = join(work, "EPUB", "text");
  for (const name of readdirSync(textDir)) {
    if (!name.endsWith(".xhtml") || name === "ch001.xhtml") continue;
    const p = join(textDir, name);
    if (!statSync(p).isFile()) continue;
    let html = readFileSync(p, "utf8");
    const next = html.replace(/\sstyle="width:[^"]*"/g, "");
    if (next !== html) writeFileSync(p, next);
  }

  // Cover: pandoc ships SVG+xlink which often renders blank in epub.js WebView.
  // Replace with a plain <img> so the cover is visible and swipeable.
  const coverPath = join(textDir, "cover.xhtml");
  if (existsSync(coverPath)) {
    const coverImg =
      opf.match(/properties="cover-image"[^>]*href="([^"]+)"/)?.[1] ||
      opf.match(/href="([^"]+)"[^>]*properties="cover-image"/)?.[1] ||
      "media/file35.jpg";
    const coverHref = coverImg.startsWith("../") ? coverImg : `../${coverImg.replace(/^\//, "")}`;
    writeFileSync(
      coverPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ru" xml:lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Cover</title>
  <link rel="stylesheet" type="text/css" href="../styles/stylesheet1.css" />
</head>
<body id="cover">
  <div id="cover-image">
    <img src="${coverHref}" alt="Cover" />
  </div>
</body>
</html>
`,
    );
  }

  // Rebuild zip (mimetype must be first, stored uncompressed).
  if (existsSync(outEpub)) rmSync(outEpub);
  execFileSync("zip", ["-X0", outEpub, "mimetype"], { cwd: work, stdio: "inherit" });
  execFileSync("zip", ["-Xr9D", outEpub, "META-INF", "EPUB"], {
    cwd: work,
    stdio: "inherit",
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}

copyFileSync(outEpub, assetPath);
console.log("OK", outEpub);
console.log("→", assetPath);
