export type PracticeSelectorKind = "breath" | "meditation" | "yoga";

export interface PracticeSelectorCandidate {
  id: string;
  slug: string;
  kind: PracticeSelectorKind;
  defaultDurationSec?: number | null;
  quality?: number | null;
  recordedAt?: string | null;
  chakraIds?: readonly number[] | null;
}

export interface SelectPracticeCandidateInput<T extends PracticeSelectorCandidate> {
  candidates: readonly T[];
  preferredKind?: PracticeSelectorKind | null;
  chakraId?: number | null;
  targetDurationSec?: number | null;
  recentIds?: Iterable<string>;
  markerId?: string | null;
  yogaDurationTolerance?: number;
}

export interface SelectPracticeCandidateResult<T extends PracticeSelectorCandidate> {
  picked: T;
  stack: T[];
  baseStack: T[];
  excludedRecentCount: number;
  markerIdResolved: boolean | undefined;
}

const DEFAULT_QUALITY = 3;
const DEFAULT_YOGA_DURATION_TOLERANCE = 0.15;

export function recentStackLimitForKind(kind: PracticeSelectorKind | null | undefined, activePracticeCount = 0): number {
  if (kind === "yoga") return 15;
  if (kind === "breath" || kind === "meditation") return Math.max(1, activePracticeCount);
  return 20;
}

export function practiceQuality(practice: Pick<PracticeSelectorCandidate, "quality">): number {
  return typeof practice.quality === "number" && Number.isFinite(practice.quality)
    ? practice.quality
    : DEFAULT_QUALITY;
}

export function practiceRecordedAtMs(practice: Pick<PracticeSelectorCandidate, "recordedAt">): number {
  if (!practice.recordedAt) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(practice.recordedAt);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function practiceDurationDistance(
  practice: Pick<PracticeSelectorCandidate, "defaultDurationSec">,
  targetDurationSec: number | null | undefined,
): number {
  if (!targetDurationSec || !practice.defaultDurationSec) return 0;
  return Math.abs(practice.defaultDurationSec - targetDurationSec);
}

function durationRank(seconds: number | null | undefined): number {
  if (!seconds) return Number.MAX_SAFE_INTEGER;
  if (seconds <= 10 * 60) return 1;
  if (seconds <= 25 * 60) return 2;
  return 3;
}

function hasChakra(practice: PracticeSelectorCandidate, chakraId: number | null | undefined): boolean {
  return Boolean(chakraId && practice.chakraIds?.includes(chakraId));
}

function isWithinDurationTolerance(
  practice: PracticeSelectorCandidate,
  targetDurationSec: number,
  tolerance: number,
): boolean {
  return Boolean(
    practice.defaultDurationSec &&
      Math.abs(practice.defaultDurationSec - targetDurationSec) <= targetDurationSec * tolerance,
  );
}

export function sortPracticeCandidatesForCatalog<T extends PracticeSelectorCandidate>(practices: readonly T[]): T[] {
  return [...practices].sort((a, b) => {
    const qualityDelta = practiceQuality(b) - practiceQuality(a);
    if (qualityDelta !== 0) return qualityDelta;

    const recordedDelta = practiceRecordedAtMs(a) - practiceRecordedAtMs(b);
    if (recordedDelta !== 0) return recordedDelta;

    const durationDelta = durationRank(a.defaultDurationSec) - durationRank(b.defaultDurationSec);
    if (durationDelta !== 0) return durationDelta;

    return a.slug.localeCompare(b.slug, "ru");
  });
}

export function sortPracticeCandidatesForRecommendation<T extends PracticeSelectorCandidate>(
  practices: readonly T[],
  targetDurationSec?: number | null,
  durationFirst = false,
): T[] {
  return [...practices].sort((a, b) => {
    if (durationFirst) {
      const durationDelta = practiceDurationDistance(a, targetDurationSec) - practiceDurationDistance(b, targetDurationSec);
      if (durationDelta !== 0) return durationDelta;
    }

    const qualityDelta = practiceQuality(b) - practiceQuality(a);
    if (qualityDelta !== 0) return qualityDelta;

    const recordedDelta = practiceRecordedAtMs(a) - practiceRecordedAtMs(b);
    if (recordedDelta !== 0) return recordedDelta;

    if (!durationFirst) {
      const durationDelta = practiceDurationDistance(a, targetDurationSec) - practiceDurationDistance(b, targetDurationSec);
      if (durationDelta !== 0) return durationDelta;
    }

    return a.id.localeCompare(b.id);
  });
}

export function selectPracticeCandidate<T extends PracticeSelectorCandidate>(
  input: SelectPracticeCandidateInput<T>,
): SelectPracticeCandidateResult<T> | null {
  const candidates = input.preferredKind
    ? input.candidates.filter((practice) => practice.kind === input.preferredKind)
    : [...input.candidates];
  if (!candidates.length) return null;

  const chakraMatches = input.chakraId ? candidates.filter((practice) => hasChakra(practice, input.chakraId)) : [];
  const chakraPool = chakraMatches.length ? chakraMatches : candidates;
  const tolerance = input.yogaDurationTolerance ?? DEFAULT_YOGA_DURATION_TOLERANCE;
  const durationWindow =
    input.preferredKind === "yoga" && input.targetDurationSec
      ? chakraPool.filter((practice) => isWithinDurationTolerance(practice, input.targetDurationSec as number, tolerance))
      : [];
  const baseStack = durationWindow.length ? durationWindow : chakraPool;
  const recentIds = new Set(input.recentIds ?? []);
  const freshStack = baseStack.filter((practice) => !recentIds.has(practice.id) && !recentIds.has(practice.slug));
  const durationFirst = input.preferredKind === "yoga" && Boolean(input.targetDurationSec) && durationWindow.length === 0;
  const stack = sortPracticeCandidatesForRecommendation(
    freshStack.length ? freshStack : baseStack,
    input.targetDurationSec,
    durationFirst,
  );
  const markerPick = input.markerId
    ? stack.find((practice) => practice.id === input.markerId || practice.slug === input.markerId)
    : undefined;
  const picked = markerPick ?? stack[0];

  if (!picked) return null;
  const markerIdResolved = input.markerId ? Boolean(markerPick) : undefined;
  return {
    picked,
    stack,
    baseStack,
    excludedRecentCount: baseStack.length - freshStack.length,
    markerIdResolved,
  };
}
