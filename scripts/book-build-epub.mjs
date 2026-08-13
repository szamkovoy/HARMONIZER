/**
 * Build EPUB 3 from Book/*.docx (local pipeline; no deploy).
 *
 *   node scripts/book-build-epub.mjs ru|en|de|fr|it|es|pt|nl
 *
 * Requires: pandoc + unzip/zip on PATH.
 * Writes Book/build/{locale}/book.epub (Metro GET /hz-book/{locale}.epub).
 * Does not copy into assets/books — require() EPUBs break Dev Client cold start.
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
  renameSync,
} from "fs";
import { join, dirname, extname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

/** Recompress EPUB media for phone reading (~200–300KB each, max edge 1024). */
function compressEpubMedia(epubRoot) {
  const mediaDir = join(epubRoot, "EPUB", "media");
  if (!existsSync(mediaDir)) return [];
  /** @type {Array<[string, string]>} oldName → newName */
  const renames = [];
  let saved = 0;
  for (const name of readdirSync(mediaDir)) {
    const ext = extname(name).toLowerCase();
    if (ext !== ".jpg" && ext !== ".jpeg" && ext !== ".png") continue;
    const src = join(mediaDir, name);
    const before = statSync(src).size;
    const base = name.replace(/\.[^.]+$/, "");
    const tmp = join(mediaDir, `.tmp-${base}.jpg`);
    try {
      // sips: cap longest side, JPEG q≈72 (formatOptions 0–100).
      execFileSync(
        "sips",
        [
          "--resampleHeightWidthMax",
          "1024",
          "-s",
          "format",
          "jpeg",
          "-s",
          "formatOptions",
          "72",
          src,
          "--out",
          tmp,
        ],
        { stdio: "pipe" },
      );
      if (!existsSync(tmp)) continue;
      let after = statSync(tmp).size;
      // Second pass if still heavy (busy photos stay large at q72).
      if (after > 320 * 1024) {
        const tmp2 = join(mediaDir, `.tmp2-${base}.jpg`);
        try {
          execFileSync(
            "sips",
            [
              "--resampleHeightWidthMax",
              "960",
              "-s",
              "format",
              "jpeg",
              "-s",
              "formatOptions",
              "58",
              tmp,
              "--out",
              tmp2,
            ],
            { stdio: "pipe" },
          );
          if (existsSync(tmp2) && statSync(tmp2).size > 0) {
            rmSync(tmp, { force: true });
            renameSync(tmp2, tmp);
            after = statSync(tmp).size;
          }
        } catch {
          try {
            rmSync(tmp2, { force: true });
          } catch {
            /* ignore */
          }
        }
      }
      // Prefer recompressed when smaller, PNG→JPEG, or we beat a 320KB budget.
      if (after > 0 && (after < before || ext === ".png" || after <= 320 * 1024)) {
        const newName = `${base}.jpg`;
        const destJpg = join(mediaDir, newName);
        if (existsSync(destJpg) && destJpg !== src) rmSync(destJpg);
        renameSync(tmp, destJpg);
        if (destJpg !== src && existsSync(src)) rmSync(src);
        if (name !== newName) renames.push([name, newName]);
        saved += Math.max(0, before - after);
        console.log(
          `  media ${name} → ${Math.round(after / 1024)}KB (was ${Math.round(before / 1024)}KB)`,
        );
      } else {
        rmSync(tmp, { force: true });
      }
    } catch {
      try {
        rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
  if (saved > 0) console.log(`  media saved ~${Math.round(saved / 1024)}KB`);
  return renames;
}

function rewriteMediaRefs(epubRoot, renames) {
  if (!renames.length) return;
  const roots = [join(epubRoot, "EPUB", "content.opf"), join(epubRoot, "EPUB", "text")];
  for (const [from, to] of renames) {
    const re = new RegExp(from.replace(/\./g, "\\."), "g");
    for (const target of roots) {
      if (statSync(target).isDirectory()) {
        for (const name of readdirSync(target)) {
          if (!name.endsWith(".xhtml") && !name.endsWith(".html")) continue;
          const p = join(target, name);
          const html = readFileSync(p, "utf8");
          const next = html.replace(re, to);
          if (next !== html) writeFileSync(p, next);
        }
      } else if (existsSync(target)) {
        let opf = readFileSync(target, "utf8");
        opf = opf.replace(re, to);
        opf = opf.replace(
          new RegExp(`(href="media/${to.replace(/\./g, "\\.")}")([^>]*media-type=")image/png(")`, "g"),
          '$1$2image/jpeg$3',
        );
        writeFileSync(target, opf);
      }
    }
  }
}

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
  de: {
    docx: "Book_De.docx",
    cover: "cover_De.jpg",
    title: "Yoga — der Weg des Zauberers",
    author: "Sergei Zamkovoi",
    lang: "de",
    asset: "yoga-wizards-path-de.epub",
  },
  fr: {
    docx: "Book_Fr.docx",
    cover: "cover_Fr.jpg",
    title: "Yoga — la voie du magicien",
    author: "Sergei Zamkovoi",
    lang: "fr",
    asset: "yoga-wizards-path-fr.epub",
  },
  it: {
    docx: "Book_It.docx",
    cover: "cover_It.jpg",
    title: "Yoga — la via del mago",
    author: "Sergei Zamkovoi",
    lang: "it",
    asset: "yoga-wizards-path-it.epub",
  },
  es: {
    docx: "Book_Es.docx",
    cover: "cover_Es.jpg",
    title: "Yoga — el camino del mago",
    author: "Sergei Zamkovoi",
    lang: "es",
    asset: "yoga-wizards-path-es.epub",
  },
  pt: {
    docx: "Book_Pt.docx",
    cover: "cover_Pt.jpg",
    title: "Yoga — o caminho do mago",
    author: "Sergei Zamkovoi",
    lang: "pt",
    asset: "yoga-wizards-path-pt.epub",
  },
  nl: {
    docx: "Book_Nl.docx",
    cover: "cover_Nl.jpg",
    title: "Yoga — de weg van de tovenaar",
    author: "Sergei Zamkovoi",
    lang: "nl",
    asset: "yoga-wizards-path-nl.epub",
  },
};

const cfg = SOURCES[locale];
if (!cfg) {
  console.error("Usage: node scripts/book-build-epub.mjs ru|en|de|fr|it|es|pt|nl");
  process.exit(1);
}

/** Word-embedded TOC section ids (pandoc slugs) across locales. */
const TOC_SECTION_IDS =
  "оглавление|contents|table-of-contents|toc|inhaltsverzeichnis|table-des-matières|table-des-matieres|indice|índice|inhoudsopgave";

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

  // Strip Word-embedded TOC block from ch001 (RU/EN/DE ids); keep Prologue and the rest.
  const ch001Path = join(work, "EPUB", "text", "ch001.xhtml");
  if (existsSync(ch001Path)) {
    let html = readFileSync(ch001Path, "utf8");
    html = html.replace(
      new RegExp(
        `<section[^>]*id="(?:${TOC_SECTION_IDS})"[^>]*>[\\s\\S]*?<\\/section>\\s*`,
        "iu",
      ),
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

  // Promote Prologue (etc.) out of the Word TOC wrapper; drop empty #section.
  const navPath = join(work, "EPUB", "nav.xhtml");
  if (existsSync(navPath)) {
    let nav = readFileSync(navPath, "utf8");
    nav = nav.replace(
      new RegExp(
        `<li[^>]*>\\s*<a[^>]*href="[^"]*#(?:${TOC_SECTION_IDS})"[^>]*>[^<]*<\\/a>\\s*<ol[^>]*>([\\s\\S]*?)<\\/ol>\\s*<\\/li>`,
        "iu",
      ),
      (_, inner) =>
        String(inner)
          .replace(/<li[^>]*>\s*<a[^>]*href="[^"]*#section"[^>]*\s*\/>\s*<\/li>/giu, "")
          .replace(/<li[^>]*>\s*<a[^>]*href="[^"]*#section"[^>]*>\s*<\/a>\s*<\/li>/giu, ""),
    );
    writeFileSync(navPath, nav);
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
    // Re-read opf after possible earlier edits.
    opf = readFileSync(opfPath, "utf8");
    const coverImg =
      opf.match(/properties="cover-image"[^>]*href="([^"]+)"/)?.[1] ||
      opf.match(/href="([^"]+)"[^>]*properties="cover-image"/)?.[1] ||
      "media/file35.jpg";
    const coverHref = coverImg.startsWith("../") ? coverImg : `../${coverImg.replace(/^\//, "")}`;
    writeFileSync(
      coverPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${cfg.lang}" xml:lang="${cfg.lang}">
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

  console.log("compress media…");
  const renames = compressEpubMedia(work);
  rewriteMediaRefs(work, renames);
  // Cover href may have been .png → .jpg
  if (existsSync(coverPath) && renames.length) {
    let coverHtml = readFileSync(coverPath, "utf8");
    for (const [from, to] of renames) {
      coverHtml = coverHtml.split(from).join(to);
    }
    writeFileSync(coverPath, coverHtml);
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

// Never copy into assets/books — multi‑MB require() assets wreck Dev Client
// cold start. Dev serves Book/build/{locale}/book.epub at /hz-book/{locale}.epub.
console.log("OK", outEpub);
console.log("(Dev: GET /hz-book/" + locale + ".epub — not copied to assets/)");
