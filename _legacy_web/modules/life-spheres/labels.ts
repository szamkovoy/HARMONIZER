import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { asContentLocale, SOURCE_LOCALE } from "@/modules/i18n/localeCodes";

export type LifeSphereLocale = AppContentLocale;

type SphereRow = { id: number; title: string };

/** Canonical life-sphere titles — keep in sync with `_legacy_web/data/life_spheres_baseline/`. */
const SPHERE_TITLES: Record<AppContentLocale, Record<number, string>> = {
  ru: {
    1: "Тело и безопасность",
    2: "Удовольствия и отдых",
    3: "Проявленность и деньги",
    4: "Друзья, семья, отношения",
    5: "Ценности и самовыражение",
    6: "Познание и обучение",
    7: "Высшие смыслы, вера",
  },
  en: {
    1: "Body and safety",
    2: "Pleasure and rest",
    3: "Visibility and money",
    4: "Friends, family, relationships",
    5: "Values and self-expression",
    6: "Knowledge and learning",
    7: "Higher meaning, faith",
  },
  de: {
    1: "Körper und Sicherheit",
    2: "Genuss und Erholung",
    3: "Sichtbarkeit und Geld",
    4: "Freunde, Familie, Beziehungen",
    5: "Werte und Selbstausdruck",
    6: "Wissen und Lernen",
    7: "Höhere Bedeutung, Glaube",
  },
  fr: {
    1: "Corps et sécurité",
    2: "Plaisir et repos",
    3: "Visibilité et argent",
    4: "Amis, famille, relations",
    5: "Valeurs et expression de soi",
    6: "Connaissance et apprentissage",
    7: "Sens supérieur, foi",
  },
  it: {
    1: "Corpo e sicurezza",
    2: "Piacere e riposo",
    3: "Visibilità e denaro",
    4: "Amici, famiglia, relazioni",
    5: "Valori ed espressione di sé",
    6: "Conoscenza e apprendimento",
    7: "Significati superiori, fede",
  },
  es: {
    1: "Cuerpo y seguridad",
    2: "Placer y descanso",
    3: "Visibilidad y dinero",
    4: "Amigos, familia, relaciones",
    5: "Valores y autoexpresión",
    6: "Conocimiento y aprendizaje",
    7: "Significado superior, fe",
  },
  pt: {
    1: "Corpo e segurança",
    2: "Prazer e descanso",
    3: "Visibilidade e dinheiro",
    4: "Amigos, família, relações",
    5: "Valores e autoexpressão",
    6: "Conhecimento e aprendizagem",
    7: "Significados superiores, fé",
  },
  nl: {
    1: "Lichaam en veiligheid",
    2: "Genot en rust",
    3: "Zichtbaarheid en geld",
    4: "Vrienden, familie, relaties",
    5: "Waarden en zelfexpressie",
    6: "Kennis en leren",
    7: "Hogere betekenis, geloof",
  },
};

const RU_BY_ID = SPHERE_TITLES.ru;
const RU_TITLE_TO_ID = Object.fromEntries(
  Object.entries(RU_BY_ID).map(([id, title]) => [title.toLowerCase(), Number(id)]),
);

export function coerceLifeSphereLocale(locale: string | undefined | null): LifeSphereLocale {
  return asContentLocale(locale) ?? SOURCE_LOCALE;
}

export function getLifeSphereTitle(id: number, locale: LifeSphereLocale): string {
  return SPHERE_TITLES[locale]?.[id] ?? SPHERE_TITLES.en[id] ?? RU_BY_ID[id] ?? String(id);
}

export function getLifeSphereTitles(locale: LifeSphereLocale): readonly SphereRow[] {
  const map = SPHERE_TITLES[locale] ?? SPHERE_TITLES.en;
  return Object.entries(map)
    .map(([id, title]) => ({ id: Number(id), title }))
    .sort((a, b) => a.id - b.id);
}

/** Map API-provided RU title or numeric id to the active locale. */
export function localizeLifeSphereLabel(
  id: number | undefined,
  fallbackTitle: string | undefined,
  locale: LifeSphereLocale,
): string {
  if (id && (RU_BY_ID[id] || SPHERE_TITLES.en[id])) return getLifeSphereTitle(id, locale);
  const normalized = (fallbackTitle ?? "").trim().toLowerCase();
  const mappedId = RU_TITLE_TO_ID[normalized];
  if (mappedId) return getLifeSphereTitle(mappedId, locale);
  return fallbackTitle?.trim() || (id ? String(id) : "");
}
