import type { SupabaseClient } from "@supabase/supabase-js";

import { getLifeSphereTitle } from "@/modules/life-spheres/labels";
import { asPlanningSphereCells } from "@legacy/app/api/_utils/lifeMatrix";
import { SOURCE_LOCALE, type AppContentLocale } from "@legacy/app/api/_utils/contentLocales";

export type SphereStat = {
  id: number;
  title: string;
  value: number;
  radius: number;
};

export const SPHERE_SHORT_TITLES: Record<AppContentLocale, readonly string[]> = {
  ru: ["тело", "отдых", "деньги/дела", "отношения", "ценности", "обучение", "смысл"],
  en: ["body", "rest", "money/work", "relationships", "values", "learning", "meaning"],
  de: ["Korper", "Erholung", "Geld/Aufgaben", "Beziehungen", "Werte", "Lernen", "Sinn"],
  fr: ["le corps", "le repos", "l'argent/les taches", "les relations", "les valeurs", "l'apprentissage", "le sens"],
  it: ["il corpo", "il riposo", "denaro/impegni", "le relazioni", "i valori", "l'apprendimento", "il senso"],
  es: ["el cuerpo", "el descanso", "dinero/tareas", "las relaciones", "los valores", "el aprendizaje", "el sentido"],
  pt: ["o corpo", "o descanso", "dinheiro/tarefas", "as relacoes", "os valores", "o aprendizado", "o sentido"],
  nl: ["het lichaam", "rust", "geld/taken", "relaties", "waarden", "leren", "betekenis"],
};

const SPHERE_HINT_COPY: Record<
  AppContentLocale,
  {
    narrow: (activeText: string, missingText: string, activeCount: number) => string;
    wide: (missingText: string) => string;
  }
> = {
  ru: {
    narrow: (activeText, missingText, activeCount) =>
      `Сейчас сильнее ${activeCount === 1 ? "звучит" : "звучат"} ${activeText}. Для баланса добавьте небольшое действие: ${missingText}.`,
    wide: (missingText) => `Баланс уже шире. Можно добавить ${missingText} — эта сфера пока почти не звучит.`,
  },
  en: {
    narrow: (activeText, missingText) =>
      `Right now ${activeText} sounds strongest. To balance the day, add one small action around ${missingText}.`,
    wide: (missingText) => `The balance is already broader. You can still add ${missingText} - this sphere is barely sounding yet.`,
  },
  de: {
    narrow: (activeText, missingText) =>
      `Im Moment klingt ${activeText} am starksten. Fur mehr Balance fugen Sie eine kleine Handlung rund um ${missingText} hinzu.`,
    wide: (missingText) => `Die Balance ist bereits breiter. Sie konnen noch ${missingText} hinzufugen - diese Sphare klingt bisher kaum an.`,
  },
  fr: {
    narrow: (activeText, missingText) =>
      `Pour l'instant, ${activeText} ressort le plus. Pour equilibrer la journee, ajoutez une petite action autour de ${missingText}.`,
    wide: (missingText) => `L'equilibre est deja plus large. Vous pouvez encore ajouter ${missingText} - cette sphere reste presque muette.`,
  },
  it: {
    narrow: (activeText, missingText) =>
      `Per ora emerge soprattutto ${activeText}. Per riequilibrare la giornata, aggiungi una piccola azione intorno a ${missingText}.`,
    wide: (missingText) => `L'equilibrio e gia piu ampio. Puoi ancora aggiungere ${missingText} - questa sfera si sente ancora molto poco.`,
  },
  es: {
    narrow: (activeText, missingText) =>
      `Por ahora destaca sobre todo ${activeText}. Para equilibrar el dia, anade una pequena accion alrededor de ${missingText}.`,
    wide: (missingText) => `El equilibrio ya es mas amplio. Aun puedes anadir ${missingText} - esta esfera casi no suena todavia.`,
  },
  pt: {
    narrow: (activeText, missingText) =>
      `Por enquanto, ${activeText} aparece com mais forca. Para equilibrar o dia, adicione uma pequena acao em torno de ${missingText}.`,
    wide: (missingText) => `O equilibrio ja esta mais amplo. Ainda da para adicionar ${missingText} - esta esfera quase nao esta soando.`,
  },
  nl: {
    narrow: (activeText, missingText) =>
      `Op dit moment klinkt vooral ${activeText} het sterkst. Voeg voor meer balans een kleine actie rond ${missingText} toe.`,
    wide: (missingText) => `De balans is al breder. Je kunt nog ${missingText} toevoegen - deze sfeer klinkt nog maar heel zacht mee.`,
  },
};

function shortSphereTitle(stat: SphereStat, locale: AppContentLocale): string {
  const shortTitles = SPHERE_SHORT_TITLES[locale] ?? SPHERE_SHORT_TITLES.en;
  return shortTitles[stat.id - 1] ?? stat.title.toLowerCase();
}

function sphereBalanceFacts(stats: SphereStat[]) {
  const active = stats.filter((item) => item.value > 0.001).sort((left, right) => right.value - left.value);
  const missing = stats.filter((item) => item.value <= 0.001);
  return { active, missing };
}

export function buildSphereStats(actions: Array<{ cells: unknown }>, locale: AppContentLocale): SphereStat[] {
  const totals = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1,
    title: getLifeSphereTitle(index + 1, locale),
    value: 0,
  }));
  for (const action of actions) {
    for (const cell of asPlanningSphereCells(action.cells)) {
      if (cell.sphere >= 1 && cell.sphere <= 7) {
        totals[cell.sphere - 1]!.value += cell.weight;
      }
    }
  }
  const max = Math.max(0, ...totals.map((item) => item.value));
  return totals.map((item) => ({
    ...item,
    radius: max > 0 ? Math.sqrt(item.value / max) : 0,
  }));
}

export function buildSphereHint(stats: SphereStat[], locale: AppContentLocale): string | null {
  const { active, missing } = sphereBalanceFacts(stats);
  if (!active.length) return null;
  if (active.length >= 5) return null;
  const shortTitles = SPHERE_SHORT_TITLES[locale] ?? SPHERE_SHORT_TITLES.en;
  const activeNames = active
    .slice(0, 2)
    .map((item) => shortTitles[item.id - 1] ?? item.title.toLowerCase());
  const missingNames = missing
    .slice(0, 2)
    .map((item) => shortTitles[item.id - 1] ?? item.title.toLowerCase());
  const copy = SPHERE_HINT_COPY[locale] ?? SPHERE_HINT_COPY.en;
  const primaryMissing = missingNames[0] ?? (locale === SOURCE_LOCALE ? "другую сферу" : "another sphere");
  if (active.length <= 2) {
    const activeText = activeNames.length === 1 ? activeNames[0] : activeNames.join(" и ");
    const missingText = missingNames.length >= 2 ? `${missingNames[0]} или ${missingNames[1]}` : primaryMissing;
    return copy.narrow(activeText, missingText, activeNames.length);
  }
  return copy.wide(primaryMissing);
}

/** Compact sphere-balance facts for add-flow opening (same stats source as Day-tab sphereHint). */
export function buildSphereBalanceLensForPrompt(stats: SphereStat[], locale: AppContentLocale): string | null {
  const { active, missing } = sphereBalanceFacts(stats);
  if (!active.length || active.length >= 5) return null;
  const activeNames = active.slice(0, 2).map((item) => shortSphereTitle(item, locale));
  const missingNames = missing.slice(0, 2).map((item) => shortSphereTitle(item, locale));
  const missingText = missingNames.length
    ? missingNames.join(", ")
    : (locale === SOURCE_LOCALE ? "другие сферы" : "other spheres");
  return `Sphere balance: already strong in ${activeNames.join(", ")}; barely present: ${missingText}.`;
}

export async function loadRecentSphereRows(
  db: SupabaseClient,
  userId: string,
  throughLocalDate: string,
): Promise<Array<{ cells: unknown }>> {
  const { data, error } = await db
    .from("planned_events")
    .select("planned_local_date,cells")
    .eq("user_id", userId)
    .lte("planned_local_date", throughLocalDate)
    .in("status", ["planned", "summarized"])
    .order("planned_local_date", { ascending: false })
    .order("display_order", { ascending: true, nullsFirst: false })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ planned_local_date: string | null; cells: unknown }>;
  const activeDates = [...new Set(rows.map((row) => row.planned_local_date).filter((value): value is string => Boolean(value)))].slice(0, 7);
  const activeDateSet = new Set(activeDates);
  return rows.filter((row) => row.planned_local_date && activeDateSet.has(row.planned_local_date));
}
