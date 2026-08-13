/**
 * Assemble translated chapter Markdown → Book/Book_{Locale}.docx
 *
 *   node scripts/book-assemble-docx.mjs fr
 *   node scripts/book-assemble-docx.mjs --all
 *
 * Uses EN media extract at Book/translations/_media (image paths preserved).
 * Cover for EPUB build: cover_{Locale}.jpg if present, else cover_En.jpg.
 */
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const META = {
  fr: {
    title: "Yoga — la voie du magicien",
    author: "Sergei Zamkovoi",
    docx: "Book_Fr.docx",
    assetLocale: "fr",
  },
  it: {
    title: "Yoga — la via del mago",
    author: "Sergei Zamkovoi",
    docx: "Book_It.docx",
    assetLocale: "it",
  },
  es: {
    title: "Yoga — el camino del mago",
    author: "Sergei Zamkovoi",
    docx: "Book_Es.docx",
    assetLocale: "es",
  },
  pt: {
    title: "Yoga — o caminho do mago",
    author: "Sergei Zamkovoi",
    docx: "Book_Pt.docx",
    assetLocale: "pt",
  },
  nl: {
    title: "Yoga — de weg van de tovenaar",
    author: "Sergei Zamkovoi",
    docx: "Book_Nl.docx",
    assetLocale: "nl",
  },
};

function assemble(locale) {
  const meta = META[locale];
  if (!meta) {
    console.error("Usage: node scripts/book-assemble-docx.mjs fr|it|es|pt|nl|--all");
    process.exit(1);
  }
  const chapDir = join(root, "Book/translations", locale, "chapters");
  const enManifest = join(root, "Book/translations/en/chapters/manifest.json");
  if (!existsSync(enManifest)) {
    console.error("Missing EN manifest — run book-split-chapters.mjs");
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(enManifest, "utf8"));
  const missing = manifest.filter((c) => !existsSync(join(chapDir, `${c.id}.md`)));
  if (missing.length) {
    console.error(
      `[${locale}] missing ${missing.length} chapters, e.g.`,
      missing.slice(0, 5).map((c) => c.id).join(", "),
    );
    process.exit(1);
  }

  const outMdDir = join(root, "Book/translations", locale);
  mkdirSync(outMdDir, { recursive: true });
  const bookMd = join(outMdDir, "book.md");
  const chunks = manifest.map((c) => readFileSync(join(chapDir, `${c.id}.md`), "utf8").trimEnd());
  writeFileSync(bookMd, chunks.join("\n\n") + "\n");

  const docxPath = join(root, "Book", meta.docx);
  console.log("pandoc", locale, "→", meta.docx);
  execFileSync(
    "pandoc",
    [
      bookMd,
      "-o",
      docxPath,
      `--resource-path=${root}`,
      `--metadata=title:${meta.title}`,
      `--metadata=author:${meta.author}`,
      `--metadata=lang:${locale}`,
    ],
    { cwd: root, stdio: "inherit" },
  );

  // Cover for EPUB: cover_Fr.jpg etc. Until locale art exists, copy EN.
  const coverName = `cover_${locale.charAt(0).toUpperCase()}${locale.slice(1)}.jpg`;
  const coverPath = join(root, "Book", coverName);
  const enCover = join(root, "Book", "cover_En.jpg");
  if (!existsSync(coverPath) && existsSync(enCover)) {
    copyFileSync(enCover, coverPath);
    console.log("(temp cover)", coverName, "← cover_En.jpg");
  }

  console.log("OK", docxPath);
}

const arg = (process.argv[2] || "").toLowerCase();
if (arg === "--all") {
  for (const locale of Object.keys(META)) assemble(locale);
} else {
  assemble(arg);
}
