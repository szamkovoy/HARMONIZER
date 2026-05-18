import baselineEn from "../../../data/life_spheres_baseline/en.json";
import baselineRu from "../../../data/life_spheres_baseline/ru.json";

export type LifeSphereBaselineItem = {
  id: number;
  slug: string;
  title: string;
  prompt_hint: string;
};

export function getLifeSpheresBaseline(locale?: string | null): LifeSphereBaselineItem[] {
  return locale?.startsWith("en") ? baselineEn as LifeSphereBaselineItem[] : baselineRu as LifeSphereBaselineItem[];
}

export function formatLifeSpheresBaselineForPrompt(locale?: string | null): string {
  return getLifeSpheresBaseline(locale)
    .map((item) => `${item.id}. ${item.title}: ${item.prompt_hint}`)
    .join("\n");
}
