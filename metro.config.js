// @ts-check
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Phase A: bundle local EPUB for the book reader (Dev Client / EAS).
config.resolver.assetExts = [...(config.resolver.assetExts ?? []), "epub"];

/**
 * `Book/` holds multi‑MB DOCX/covers/build outputs (~50MB). Metro must not
 * watch or crawl them — with `expo start -c` that crawl alone can make the
 * Dev Client sit on “Downloading …” for minutes. JS never imports from `Book/`
 * (pipeline is `scripts/book-build-epub.mjs` → `assets/books/*.epub`).
 *
 * Store/production binaries are unaffected until a new EAS build; this only
 * changes Metro’s local resolver/watch graph.
 */
const bookDirPattern = path
  .resolve(__dirname, "Book")
  .replace(/[/\\]/g, "[/\\\\]");
const bookBlock = new RegExp(`^${bookDirPattern}[/\\\\].*`);

const prev = config.resolver.blockList;
const prevList = Array.isArray(prev) ? prev : prev ? [prev] : [];
config.resolver.blockList = [...prevList, bookBlock];

module.exports = config;
