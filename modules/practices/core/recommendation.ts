import type { PracticeSelectorKind } from "./selector";

export interface PracticeRecommendationLaunch {
  route: string;
  params: Record<string, string>;
}

export interface PracticeRecommendation {
  id: string;
  slug: string;
  name: string;
  kind: PracticeSelectorKind;
  reason?: string | null;
  durationSec: number | null;
  minDurationSec: number | null;
  maxDurationSec: number | null;
  chakraIds: number[];
  launch: PracticeRecommendationLaunch;
  hasDescription: boolean;
  hasInstructionVideo: boolean;
}
