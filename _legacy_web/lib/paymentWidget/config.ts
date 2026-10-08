/**
 * Landing payment widget config (stored in payment_widgets.config).
 * Shared by the admin editor, the public config API and the checkout API.
 */
import {
  WIDGET_EDITABLE_KEYS,
  WIDGET_LOCALES,
  getWidgetEditableDefaults,
  getWidgetSystemTexts,
  isWidgetLocale,
  type WidgetEditableTexts,
  type WidgetLocale,
  type WidgetSystemTexts,
} from "./copy";

/** Public origin for the embed code (REG.RU proxy; *.vercel.app is blocked in Russia). */
export const WIDGET_PUBLIC_ORIGIN = "https://harmonizer.zamkovoi.yoga";

export function widgetEmbedCode(widgetId: string, lang: string): string {
  return `<script src="${WIDGET_PUBLIC_ORIGIN}/widget.js" data-id="${widgetId}" data-lang="${lang}" async></script>`;
}

export const WIDGET_ELEMENT_TYPES = [
  "title",
  "text",
  "method",
  "price",
  "name",
  "email",
  "button",
  "footer",
] as const;
export type WidgetElementType = (typeof WIDGET_ELEMENT_TYPES)[number];

export type WidgetElement = { type: WidgetElementType; visible: boolean };

/** choice = visitor picks; ru = only Russian card (ЮKassa); int = only international (Lava). */
export type WidgetPaymentMode = "choice" | "ru" | "int";
export type WidgetMethod = "ru" | "int";

export type WidgetStyle = {
  background: string;
  textColor: string;
  accentColor: string;
  buttonTextColor: string;
  borderWidth: number;
  borderColor: string;
  radius: number;
  paddingTop: number;
  paddingBottom: number;
  paddingX: number;
  maxWidth: number;
  fontFamily: string;
  fontSize: number;
  titleSize: number;
  align: "center" | "left";
  controlRadius: number;
};

export type WidgetConfig = {
  defaultLocale: WidgetLocale;
  paymentMode: WidgetPaymentMode;
  successUrl: string | null;
  requireName: boolean;
  elements: WidgetElement[];
  style: WidgetStyle;
  texts: Partial<Record<WidgetLocale, Partial<WidgetEditableTexts>>>;
};

export const DEFAULT_WIDGET_STYLE: WidgetStyle = {
  background: "#ffffff",
  textColor: "#1f2937",
  accentColor: "#0f3d2e",
  buttonTextColor: "#ffffff",
  borderWidth: 0,
  borderColor: "#e5e7eb",
  radius: 12,
  paddingTop: 24,
  paddingBottom: 24,
  paddingX: 24,
  maxWidth: 480,
  fontFamily: "inherit",
  fontSize: 16,
  titleSize: 24,
  align: "center",
  controlRadius: 6,
};

export const WIDGET_FONT_OPTIONS: { value: string; label: string }[] = [
  { value: "inherit", label: "Как на странице сайта" },
  { value: "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif", label: "Системный" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "Georgia, 'Times New Roman', serif", label: "Georgia (с засечками)" },
  { value: "Montserrat, Arial, sans-serif", label: "Montserrat (если подключён на сайте)" },
  { value: "'Open Sans', Arial, sans-serif", label: "Open Sans (если подключён на сайте)" },
  { value: "Roboto, Arial, sans-serif", label: "Roboto (если подключён на сайте)" },
];

const DEFAULT_ELEMENTS: WidgetElement[] = WIDGET_ELEMENT_TYPES.map((type) => ({
  type,
  visible: true,
}));

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|transparent|rgba?\([\d\s.,%]+\))$/i;

function color(value: unknown, fallback: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  return COLOR_RE.test(s) ? s : fallback;
}

function fontFamily(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return DEFAULT_WIDGET_STYLE.fontFamily;
  return /^[\w\s,'"-]{1,160}$/.test(s) ? s : DEFAULT_WIDGET_STYLE.fontFamily;
}

/** http(s) URL or null. */
export function normalizeHttpUrl(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s || s.length > 1000) return null;
  try {
    const url = new URL(s);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeElements(raw: unknown): WidgetElement[] {
  if (!Array.isArray(raw)) return DEFAULT_ELEMENTS.map((e) => ({ ...e }));
  const seen = new Set<WidgetElementType>();
  const out: WidgetElement[] = [];
  for (const item of raw) {
    const type = (item as { type?: unknown })?.type;
    if (typeof type !== "string" || !(WIDGET_ELEMENT_TYPES as readonly string[]).includes(type)) continue;
    const t = type as WidgetElementType;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push({ type: t, visible: (item as { visible?: unknown }).visible !== false });
  }
  for (const def of DEFAULT_ELEMENTS) {
    if (!seen.has(def.type)) out.push({ ...def });
  }
  // Email and button are the minimum to pay.
  return out.map((e) => (e.type === "email" || e.type === "button" ? { ...e, visible: true } : e));
}

function normalizeTexts(raw: unknown): WidgetConfig["texts"] {
  const out: WidgetConfig["texts"] = {};
  if (!raw || typeof raw !== "object") return out;
  for (const locale of WIDGET_LOCALES) {
    const entry = (raw as Record<string, unknown>)[locale];
    if (!entry || typeof entry !== "object") continue;
    const texts: Partial<WidgetEditableTexts> = {};
    for (const key of WIDGET_EDITABLE_KEYS) {
      const v = (entry as Record<string, unknown>)[key];
      if (typeof v === "string") texts[key] = v.slice(0, 2000);
    }
    if (Object.keys(texts).length) out[locale] = texts;
  }
  return out;
}

export function normalizeWidgetConfig(raw: unknown): WidgetConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (r.style && typeof r.style === "object" ? r.style : {}) as Record<string, unknown>;
  const d = DEFAULT_WIDGET_STYLE;
  const mode = r.paymentMode;
  return {
    defaultLocale: isWidgetLocale(r.defaultLocale) ? r.defaultLocale : "ru",
    paymentMode: mode === "ru" || mode === "int" ? mode : "choice",
    successUrl: normalizeHttpUrl(r.successUrl),
    requireName: r.requireName !== false,
    elements: normalizeElements(r.elements),
    style: {
      background: color(s.background, d.background),
      textColor: color(s.textColor, d.textColor),
      accentColor: color(s.accentColor, d.accentColor),
      buttonTextColor: color(s.buttonTextColor, d.buttonTextColor),
      borderWidth: clampInt(s.borderWidth, 0, 8, d.borderWidth),
      borderColor: color(s.borderColor, d.borderColor),
      radius: clampInt(s.radius, 0, 40, d.radius),
      paddingTop: clampInt(s.paddingTop, 0, 120, d.paddingTop),
      paddingBottom: clampInt(s.paddingBottom, 0, 120, d.paddingBottom),
      paddingX: clampInt(s.paddingX, 0, 80, d.paddingX),
      maxWidth: clampInt(s.maxWidth, 240, 1200, d.maxWidth),
      fontFamily: fontFamily(s.fontFamily),
      fontSize: clampInt(s.fontSize, 12, 24, d.fontSize),
      titleSize: clampInt(s.titleSize, 14, 48, d.titleSize),
      align: s.align === "left" ? "left" : "center",
      controlRadius: clampInt(s.controlRadius, 0, 30, d.controlRadius),
    },
    texts: normalizeTexts(r.texts),
  };
}

/** Authored (non-empty) keys of a locale entry. */
function authoredKeys(entry: Partial<WidgetEditableTexts> | undefined): (keyof WidgetEditableTexts)[] {
  if (!entry) return [];
  return WIDGET_EDITABLE_KEYS.filter((k) => (entry[k] ?? "").trim().length > 0);
}

/**
 * Locale actually shown. A requested locale is used when it has every text the
 * author wrote in the main locale; otherwise the whole widget falls back to the
 * main locale (no mixed-language form).
 */
export function resolveWidgetLocale(config: WidgetConfig, requested: WidgetLocale | null): WidgetLocale {
  const main = config.defaultLocale;
  if (!requested || requested === main) return main;
  const required = authoredKeys(config.texts[main]);
  const entry = config.texts[requested];
  const ok = required.every((k) => (entry?.[k] ?? "").trim().length > 0);
  return ok ? requested : main;
}

export type ResolvedWidgetTexts = WidgetEditableTexts & WidgetSystemTexts;

export function resolveWidgetTexts(config: WidgetConfig, locale: WidgetLocale): ResolvedWidgetTexts {
  const defaults = getWidgetEditableDefaults(locale);
  const entry = config.texts[locale] ?? {};
  const merged = { ...defaults };
  for (const key of WIDGET_EDITABLE_KEYS) {
    const v = entry[key];
    if (typeof v === "string" && v.trim()) merged[key] = v;
  }
  return { ...merged, ...getWidgetSystemTexts(locale) };
}

/** Browser-side locale pick: data-lang="ru|en|…" or "auto" (navigator languages). */
export function pickRequestedLocale(dataLang: string | null, browserLanguages: readonly string[]): WidgetLocale | null {
  const raw = (dataLang ?? "").trim().toLowerCase();
  if (raw && raw !== "auto") return isWidgetLocale(raw.slice(0, 2)) ? (raw.slice(0, 2) as WidgetLocale) : null;
  for (const lang of browserLanguages) {
    const short = lang.trim().toLowerCase().slice(0, 2);
    if (isWidgetLocale(short)) return short;
  }
  return null;
}

/** IANA time zones of Russia — fallback when the IP country is unknown. */
const RUSSIA_TIME_ZONES = new Set([
  "Europe/Moscow",
  "Europe/Simferopol",
  "Europe/Kaliningrad",
  "Europe/Samara",
  "Europe/Volgograd",
  "Europe/Kirov",
  "Europe/Astrakhan",
  "Europe/Saratov",
  "Europe/Ulyanovsk",
  "Asia/Yekaterinburg",
  "Asia/Omsk",
  "Asia/Novosibirsk",
  "Asia/Barnaul",
  "Asia/Tomsk",
  "Asia/Novokuznetsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Chita",
  "Asia/Yakutsk",
  "Asia/Khandyga",
  "Asia/Vladivostok",
  "Asia/Ust-Nera",
  "Asia/Magadan",
  "Asia/Sakhalin",
  "Asia/Srednekolymsk",
  "Asia/Kamchatka",
  "Asia/Anadyr",
]);

export function isRussiaTimeZone(tz: string | null | undefined): boolean {
  return RUSSIA_TIME_ZONES.has((tz ?? "").trim());
}

/** Default method: RU visitors → Russian card; everyone else / unknown → international. */
export function defaultWidgetMethod(params: {
  country: string | null;
  timeZone: string | null;
}): WidgetMethod {
  const country = (params.country ?? "").trim().toUpperCase();
  if (country) return country === "RU" ? "ru" : "int";
  return isRussiaTimeZone(params.timeZone) ? "ru" : "int";
}

/** Lava currency for international cards: USD for the US, EUR otherwise. */
export function internationalCurrency(country: string | null): "USD" | "EUR" {
  return (country ?? "").trim().toUpperCase() === "US" ? "USD" : "EUR";
}
