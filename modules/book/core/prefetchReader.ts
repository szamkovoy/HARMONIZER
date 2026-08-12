/** Warm the lazy BookReaderScreen chunk (epub.js) so open isn't a blank spinner. */
let prefetchPromise: Promise<unknown> | null = null;

export function prefetchBookReader(): Promise<unknown> {
  if (!prefetchPromise) {
    prefetchPromise = import("@/modules/book/ui/BookReaderScreen").catch(() => {
      prefetchPromise = null;
    });
  }
  return prefetchPromise;
}
