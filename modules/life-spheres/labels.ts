import type { AppContentLocale } from "@/modules/i18n/localeCodes";

export type LifeSphereLocale = AppContentLocale;

type SphereRow = { id: number; title: string };

/** Canonical life-sphere titles — keep in sync with `_legacy_web/data/life_spheres_baseline/`. */
const RU_SPHERES: readonly SphereRow[] = [
  { id: 1, title: "Тело и безопасность" },
  { id: 2, title: "Удовольствия и отдых" },
  { id: 3, title: "Проявленность и деньги" },
  { id: 4, title: "Друзья, семья, отношения" },
  { id: 5, title: "Ценности и самовыражение" },
  { id: 6, title: "Познание и обучение" },
  { id: 7, title: "Высшие смыслы, вера" },
];

const EN_SPHERES: readonly SphereRow[] = [
  { id: 1, title: "Body and safety" },
  { id: 2, title: "Pleasure and rest" },
  { id: 3, title: "Visibility and money" },
  { id: 4, title: "Friends, family, relationships" },
  { id: 5, title: "Values and self-expression" },
  { id: 6, title: "Knowledge and learning" },
  { id: 7, title: "Higher meaning, faith" },
];

const RU_BY_ID = Object.fromEntries(RU_SPHERES.map((row) => [row.id, row.title]));
const EN_BY_ID = Object.fromEntries(EN_SPHERES.map((row) => [row.id, row.title]));
const RU_TITLE_TO_ID = Object.fromEntries(RU_SPHERES.map((row) => [row.title.toLowerCase(), row.id]));

export function coerceLifeSphereLocale(locale: string | undefined | null): LifeSphereLocale {
  const normalized = (locale ?? "").trim().toLowerCase();
  if (normalized.startsWith("en")) return "en";
  if (normalized.startsWith("de")) return "de";
  if (normalized.startsWith("fr")) return "fr";
  if (normalized.startsWith("it")) return "it";
  if (normalized.startsWith("es")) return "es";
  if (normalized.startsWith("pt")) return "pt";
  if (normalized.startsWith("nl")) return "nl";
  return "ru";
}

export function getLifeSphereTitle(id: number, locale: LifeSphereLocale): string {
  const map = locale === "ru" ? RU_BY_ID : EN_BY_ID;
  return map[id] ?? RU_BY_ID[id] ?? String(id);
}

export function getLifeSphereTitles(locale: LifeSphereLocale): readonly SphereRow[] {
  return locale === "ru" ? RU_SPHERES : EN_SPHERES;
}

/** Map API-provided RU title or numeric id to the active locale. */
export function localizeLifeSphereLabel(
  id: number | undefined,
  fallbackTitle: string | undefined,
  locale: LifeSphereLocale,
): string {
  if (id && (RU_BY_ID[id] || EN_BY_ID[id])) return getLifeSphereTitle(id, locale);
  const normalized = (fallbackTitle ?? "").trim().toLowerCase();
  const mappedId = RU_TITLE_TO_ID[normalized];
  if (mappedId) return getLifeSphereTitle(mappedId, locale);
  return fallbackTitle?.trim() || (id ? String(id) : "");
}
