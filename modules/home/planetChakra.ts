import type { Planet, TodayTone } from "@/modules/daily-engine";

export interface PlanetChakraMeta {
  planet: Planet;
  chakraNumber: number;
  chakraName: string;
  color: string;
  label: string;
}

export const PLANET_ORDER: Planet[] = ["Moon", "Venus", "Mars", "Jupiter", "Saturn", "Mercury", "Sun"];

export const PLANET_CHAKRA: Record<Planet, PlanetChakraMeta> = {
  Moon: {
    planet: "Moon",
    chakraNumber: 1,
    chakraName: "Муладхара",
    color: "#D32F2F",
    label: "витальность",
  },
  Venus: {
    planet: "Venus",
    chakraNumber: 2,
    chakraName: "Свадхистхана",
    color: "#FF6F00",
    label: "кайфушность",
  },
  Mars: {
    planet: "Mars",
    chakraNumber: 3,
    chakraName: "Манипура",
    color: "#FFC107",
    label: "сила",
  },
  Jupiter: {
    planet: "Jupiter",
    chakraNumber: 4,
    chakraName: "Анахата",
    color: "#4CAF50",
    label: "любовь",
  },
  Saturn: {
    planet: "Saturn",
    chakraNumber: 5,
    chakraName: "Вишуддха",
    color: "#03A9F4",
    label: "самовыражение",
  },
  Mercury: {
    planet: "Mercury",
    chakraNumber: 6,
    chakraName: "Аджна",
    color: "#3F51B5",
    label: "мудрость",
  },
  Sun: {
    planet: "Sun",
    chakraNumber: 7,
    chakraName: "Сахасрара",
    color: "#9B5BEB",
    label: "высшее Я",
  },
};

export const PLANET_LABELS: Record<Planet, string> = {
  Sun: "Солнце",
  Moon: "Луна",
  Mercury: "Меркурий",
  Venus: "Венера",
  Mars: "Марс",
  Jupiter: "Юпитер",
  Saturn: "Сатурн",
};

export function toneLabel(tone: TodayTone): string {
  if (tone === "harmonic") return "гармоничный";
  if (tone === "dissonant") return "напряжённый";
  return "нейтральный";
}

export function toneRecommendationVerb(tone: TodayTone): string {
  if (tone === "harmonic") return "мягко усилить";
  if (tone === "dissonant") return "бережно стабилизировать";
  return "спокойно настроить";
}
