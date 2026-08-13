/**
 * Split Book/translations/en/book.md into ordered chapter files.
 *
 *   node scripts/book-split-chapters.mjs
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const enBook = join(root, "Book/translations/en/book.md");
const outDir = join(root, "Book/translations/en/chapters");

if (!existsSync(enBook)) {
  console.error("Missing", enBook, "— run pandoc extract first");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const text = readFileSync(enBook, "utf8");
const parts = text.split(/(?=^#{1,2} )/m);

/** @type {{ id: string, title: string, body: string, skipTranslate?: boolean }[]} */
const chapters = [];
let idx = 0;

function slug(title) {
  return title
    .toLowerCase()
    .replace(/\{[^}]*\}/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72) || "section";
}

for (const part of parts) {
  const trimmed = part.trim();
  if (!trimmed) continue;
  const firstLine = trimmed.split("\n", 1)[0] || "";
  const title = firstLine.replace(/^#{1,2}\s+/, "").replace(/\s*\{[^}]*\}\s*$/, "").trim();
  const isToc =
    /table of contents/i.test(title) ||
    /\{#table-of-contents/i.test(firstLine) ||
    /\.TOC-Heading/i.test(firstLine);

  const id = `${String(idx).padStart(3, "0")}-${slug(title || "chunk")}`;
  chapters.push({
    id,
    title: title || id,
    body: trimmed + "\n",
    skipTranslate: isToc,
  });
  idx += 1;
}

const manifest = chapters.map((c) => ({
  id: c.id,
  title: c.title,
  skipTranslate: !!c.skipTranslate,
  words: c.body.split(/\s+/).filter(Boolean).length,
}));

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
for (const c of chapters) {
  writeFileSync(join(outDir, `${c.id}.md`), c.body);
}

console.log("OK", chapters.length, "chapters →", outDir);
console.log(
  "skip TOC:",
  chapters.filter((c) => c.skipTranslate).map((c) => c.id).join(", ") || "(none)",
);
console.log(
  "translate words:",
  chapters.filter((c) => !c.skipTranslate).reduce((a, c) => a + c.body.split(/\s+/).filter(Boolean).length, 0),
);
