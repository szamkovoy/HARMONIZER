/**
 * Lightweight public surface for Profile / gates.
 * Do NOT export BookReaderScreen here — it pulls epub.js + the EPUB asset into
 * the startup graph and freezes cold start (black screen).
 */
export { BOOK_ID, bookLocaleForAppLocale, type BookLocale } from "./core/bookIds";
export { resolveBookAccess } from "./core/bookAccess";
export { BookProfileCard } from "./ui/BookProfileCard";
