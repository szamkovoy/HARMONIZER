import type { PracticeSelectorKind } from "./selector";

export interface PracticeRecommendationLaunch {
  route: string;
  params: Record<string, string>;
}

export interface PracticeVideoThumbnail {
  url: string;
  width: number;
  height: number;
}

export interface PracticeRecommendationVideo {
  provider: string;
  url?: string | null;
  externalId?: string | null;
  thumbnail?: PracticeVideoThumbnail | null;
}

export interface PracticeRecommendation {
  id: string;
  slug: string;
  name: string;
  kind: PracticeSelectorKind;
  reason?: string | null;
  card_blurb?: string | null;
  durationSec: number | null;
  minDurationSec: number | null;
  maxDurationSec: number | null;
  chakraIds: number[];
  launch: PracticeRecommendationLaunch;
  hasDescription: boolean;
  hasInstructionVideo: boolean;
  video?: PracticeRecommendationVideo | null;
}
