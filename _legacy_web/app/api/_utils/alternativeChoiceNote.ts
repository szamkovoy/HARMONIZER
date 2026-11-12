const NOTES: Record<string, string> = {
  ru: "Сегодня предлагаем направить внимание на другую тему. Это разнообразит ваши усилия по гармонизации.",
  en: "Today we suggest turning your attention to another theme. This brings variety to your harmonizing efforts.",
  de: "Heute schlagen wir vor, die Aufmerksamkeit auf ein anderes Thema zu richten. So bleiben Ihre Bemühungen um Harmonisierung abwechslungsreich.",
  fr: "Aujourd'hui, nous vous proposons de porter l'attention sur un autre thème. Cela diversifie vos efforts d'harmonisation.",
  it: "Oggi proponiamo di rivolgere l'attenzione a un altro tema. Così i vostri sforzi di armonizzazione restano vari.",
  es: "Hoy proponemos dirigir la atención a otro tema. Así sus esfuerzos de armonización se vuelven más variados.",
  pt: "Hoje propomos dirigir a atenção para outro tema. Assim, os seus esforços de harmonização ficam mais variados.",
  nl: "Vandaag stellen we voor de aandacht op een ander thema te richten. Zo blijven je inspanningen om te harmoniseren afwisselend.",
};

const MATH_REASONS: Record<string, string> = {
  ru: "одна и та же тема лидировала два предыдущих дня",
  en: "the same theme led the two previous days",
  de: "dasselbe Thema führte an den beiden vorigen Tagen",
  fr: "le même thème a dominé les deux jours précédents",
  it: "lo stesso tema ha guidato i due giorni precedenti",
  es: "el mismo tema lideró los dos días anteriores",
  pt: "o mesmo tema liderou os dois dias anteriores",
  nl: "hetzelfde thema leidde de twee vorige dagen",
};

function localeCode(locale: string | null | undefined): string {
  const code = String(locale ?? "ru").trim().toLowerCase().slice(0, 2);
  return NOTES[code] ? code : "ru";
}

/** User-facing note when the planet of the day is the second-ranked theme. */
export function alternativeChoiceNote(locale: string | null | undefined): string {
  return NOTES[localeCode(locale)] ?? NOTES.ru;
}

/** Short reason embedded in the localized math-level line. */
export function alternativeChoiceMathReason(locale: string | null | undefined): string {
  return MATH_REASONS[localeCode(locale)] ?? MATH_REASONS.ru;
}
