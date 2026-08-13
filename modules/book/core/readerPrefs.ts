import {
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";

export type ReaderFontFamily = "serif" | "sans";
export type ReaderScrollMode = "paginated" | "scrolled";

export type ReaderPrefs = {
  fontFamily: ReaderFontFamily;
  /** Absolute font size in px for the reader WebView. */
  fontSizePx: number;
  /** Line-height multiplier, e.g. 1.55 */
  lineHeight: number;
  /** Horizontal padding in px */
  marginPx: number;
  scrollMode: ReaderScrollMode;
};

export const FONT_SIZE_MIN = 14;
export const FONT_SIZE_MAX = 28;
export const FONT_SIZE_STEP = 2;

export const LINE_HEIGHT_MIN = 1.25;
export const LINE_HEIGHT_MAX = 2.1;
export const LINE_HEIGHT_STEP = 0.1;

export const MARGIN_MIN = 8;
export const MARGIN_MAX = 40;
export const MARGIN_STEP = 4;

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  fontFamily: "serif",
  fontSizePx: 18,
  lineHeight: 1.55,
  marginPx: 16,
  scrollMode: "paginated",
};

/**
 * Simple font names only — `changeFontFamily` injects into JS with single quotes,
 * so CSS stacks like `Georgia, 'Times New Roman'` crash the WebView (white screen).
 */
export const FONT_FAMILY_CSS: Record<ReaderFontFamily, string> = {
  serif: "Georgia",
  sans: "Helvetica",
};

const PREFS_DIR = `${documentDirectory ?? ""}book-reader/`;
const PREFS_URI = `${PREFS_DIR}prefs.json`;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function normalizePrefs(raw: Partial<ReaderPrefs> | null | undefined): ReaderPrefs {
  const fontFamily = raw?.fontFamily === "sans" ? "sans" : "serif";
  const scrollMode = raw?.scrollMode === "scrolled" ? "scrolled" : "paginated";
  // Migrate old step-based prefs if present in JSON.
  const legacy = raw as { fontSizeStep?: number } | null | undefined;
  let fontSizePx = raw?.fontSizePx;
  if (typeof fontSizePx !== "number" && typeof legacy?.fontSizeStep === "number") {
    fontSizePx = [14, 16, 18, 20, 22][clamp(legacy.fontSizeStep, 0, 4)] ?? 18;
  }
  return {
    fontFamily,
    fontSizePx: clamp(typeof fontSizePx === "number" ? fontSizePx : DEFAULT_READER_PREFS.fontSizePx, FONT_SIZE_MIN, FONT_SIZE_MAX),
    lineHeight: clamp(
      typeof raw?.lineHeight === "number" ? raw.lineHeight : DEFAULT_READER_PREFS.lineHeight,
      LINE_HEIGHT_MIN,
      LINE_HEIGHT_MAX,
    ),
    marginPx: clamp(
      typeof raw?.marginPx === "number" ? raw.marginPx : DEFAULT_READER_PREFS.marginPx,
      MARGIN_MIN,
      MARGIN_MAX,
    ),
    scrollMode,
  };
}

async function ensureDir(): Promise<void> {
  if (!documentDirectory) throw new Error("documentDirectory unavailable");
  const info = await getInfoAsync(PREFS_DIR);
  if (!info.exists) {
    await makeDirectoryAsync(PREFS_DIR, { intermediates: true });
  }
}

export async function loadReaderPrefs(): Promise<ReaderPrefs> {
  try {
    if (!documentDirectory) return { ...DEFAULT_READER_PREFS };
    const info = await getInfoAsync(PREFS_URI);
    if (!info.exists) return { ...DEFAULT_READER_PREFS };
    const parsed = JSON.parse(await readAsStringAsync(PREFS_URI)) as Partial<ReaderPrefs>;
    return normalizePrefs(parsed);
  } catch {
    return { ...DEFAULT_READER_PREFS };
  }
}

export async function saveReaderPrefs(prefs: ReaderPrefs): Promise<void> {
  await ensureDir();
  await writeAsStringAsync(PREFS_URI, JSON.stringify(normalizePrefs(prefs)));
}
