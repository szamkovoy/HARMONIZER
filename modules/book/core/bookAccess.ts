/**
 * Book ownership — Phase A (store-review safe):
 * - Production / store builds: always locked (no new API deploy yet).
 * - Dev Client (`__DEV__`): unlocked so we can test the reader.
 *
 * Phase B (after moderation): GET /api/account/purchases/book → owned boolean.
 * See docs/04_workspace/book_reader_plan.md
 */
export async function resolveBookAccess(): Promise<boolean> {
  if (__DEV__) {
    return true;
  }
  return false;
}
