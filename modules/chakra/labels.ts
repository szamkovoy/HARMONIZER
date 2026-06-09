const RU_CHAKRA_FORMS: Record<number, {
  nominative: string;
  accusative: string;
  genitive: string;
}> = {
  1: { nominative: "первая чакра", accusative: "первую чакру", genitive: "первой чакры" },
  2: { nominative: "вторая чакра", accusative: "вторую чакру", genitive: "второй чакры" },
  3: { nominative: "третья чакра", accusative: "третью чакру", genitive: "третьей чакры" },
  4: { nominative: "четвёртая чакра", accusative: "четвёртую чакру", genitive: "четвёртой чакры" },
  5: { nominative: "пятая чакра", accusative: "пятую чакру", genitive: "пятой чакры" },
  6: { nominative: "шестая чакра", accusative: "шестую чакру", genitive: "шестой чакры" },
  7: { nominative: "седьмая чакра", accusative: "седьмую чакру", genitive: "седьмой чакры" },
};

const LEGACY_RU_TO_NUMBER: Record<string, number> = {
  "муладхара": 1,
  "свадхистхана": 2,
  "свадхистана": 2,
  "манипура": 3,
  "анахата": 4,
  "вишуддха": 5,
  "вишудха": 5,
  "аджна": 6,
  "сахасрара": 7,
  "первая чакра": 1,
  "вторая чакра": 2,
  "третья чакра": 3,
  "четвёртая чакра": 4,
  "четвертая чакра": 4,
  "пятая чакра": 5,
  "шестая чакра": 6,
  "седьмая чакра": 7,
};

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function chakraNumberFromRuLabel(label: string): number | null {
  return LEGACY_RU_TO_NUMBER[normalizeLabel(label)] ?? null;
}

export function chakraLabelRu(chakraNumber: number): string {
  return RU_CHAKRA_FORMS[chakraNumber]?.nominative ?? `${chakraNumber} чакра`;
}

export function chakraLabelAccusativeRu(chakraNumber: number): string {
  return RU_CHAKRA_FORMS[chakraNumber]?.accusative ?? `${chakraNumber} чакру`;
}

export function chakraLabelGenitiveRu(chakraNumber: number): string {
  return RU_CHAKRA_FORMS[chakraNumber]?.genitive ?? `${chakraNumber} чакры`;
}

export function chakraDisplayLabelRu(value: string | number): string {
  const chakraNumber = typeof value === "number" ? value : chakraNumberFromRuLabel(value);
  return chakraNumber ? chakraLabelRu(chakraNumber) : String(value);
}
