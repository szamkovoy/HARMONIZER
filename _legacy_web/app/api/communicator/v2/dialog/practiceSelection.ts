import type { SupabaseClient } from "@supabase/supabase-js";

import type { PracticeRecommendation } from "@shared/recommendation";
import { readPracticeVideoThumbnailFromParams } from "@shared/practiceVideo";
import {
  recentStackLimitForKind,
  selectPracticeCandidate,
  type PracticeSelectorCandidate,
} from "@shared/selector";
import type { PracticePickMarker } from "@legacy/app/api/_utils/markers";
import type { MessageRecord } from "@legacy/app/api/communicator/v2/dialog/dialogHelpers";

type PracticeKind = "breath" | "meditation" | "yoga";

export type PracticeCandidate = {
  id: string;
  slug: string;
  title: Record<string, string> | string | null;
  description?: Record<string, string> | string | null;
  kind: PracticeKind;
  default_duration_sec: number | null;
  min_duration_sec?: number | null;
  max_duration_sec?: number | null;
  rating?: number | null;
  params?: Record<string, unknown> | null;
  video_external_id?: string | null;
  practice_chakras?: Array<{ chakra_id: number; weight?: number | null }>;
};

type SelectablePracticeCandidate = PracticeSelectorCandidate & {
  raw: PracticeCandidate;
};

const STATIC_MEDITATION: PracticeCandidate = {
  id: "meditation:sacred-symbol-stream",
  slug: "sacred-symbol-stream",
  kind: "meditation",
  title: {
    ru: "Вспышка",
    en: "Flash",
  },
  description: {
    ru: "Короткая визуальная медитация для мягкого переключения внимания и настройки на внутренний образ.",
    en: "A short visual meditation for gently shifting attention toward an inner image.",
  },
  default_duration_sec: 5 * 60,
  min_duration_sec: null,
  max_duration_sec: null,
  rating: 3,
  params: {
    duration_policy: "fixed",
    source: "static_meditation",
  },
  practice_chakras: [
    { chakra_id: 6, weight: 1 },
    { chakra_id: 7, weight: 0.7 },
  ],
};

const STATIC_COHERENT_BREATH: PracticeCandidate = {
  id: "breath:coherent",
  slug: "coherent",
  kind: "breath",
  title: {
    ru: "Когерентное дыхание",
    en: "Coherent breathing",
  },
  description: {
    ru: "Мягкая дыхательная практика для быстрого выравнивания ритма и возврата к спокойной собранности.",
    en: "A gentle breath practice for quickly restoring rhythm and calm focus.",
  },
  default_duration_sec: 10 * 60,
  min_duration_sec: 5 * 60,
  max_duration_sec: 20 * 60,
  rating: 5,
  params: {
    duration_policy: "user_selectable",
    source: "assistant_default_breath",
  },
  practice_chakras: [],
};

const BREATH_PRACTICE_SLUGS = new Set([
  "coherent",
  "nadi-shodhana",
  "surya-bhedana",
  "chandra-bhedana",
  "square",
  "triangle-up",
  "triangle-down",
]);

export type PracticePickedPayload = PracticeRecommendation & {
  stack?: PracticeCandidate[];
};

export type PracticeSelectionContext = {
  forecast?: {
    planet_of_the_day?: unknown;
  } | null;
};

function localizedTitle(value: PracticeCandidate["title"], fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return fallback;
  return value?.ru?.trim() || value?.en?.trim() || fallback;
}

function hasLocalizedText(value: PracticeCandidate["description"]): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (!value || typeof value !== "object") return false;
  return Boolean(value?.ru?.trim() || value?.en?.trim());
}

function inferPreferredPracticeKind(text: string): PracticeKind | null {
  const lower = text.toLocaleLowerCase("ru");
  if (/(дыхан|пранаям|breath|pranayama)/i.test(lower)) return "breath";
  if (/(медитац|вспышк|символ|meditat|symbol)/i.test(lower)) return "meditation";
  if (/(асан|йог|yoga|asana)/i.test(lower)) return "yoga";
  return null;
}

function inferPreferredDurationSec(text: string): number | null {
  const match = text.match(/(\d{1,2})\s*(мин|minute|min)/i);
  if (!match) return null;
  const minutes = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : null;
}

function practiceMetaId(message: MessageRecord): string | null {
  const meta = message.meta as { practicePicked?: { id?: unknown }; practice_picked?: { id?: unknown } } | null;
  const id = meta?.practicePicked?.id ?? meta?.practice_picked?.id;
  return typeof id === "string" && id.trim() ? id : null;
}

function recentOfferedPracticeIds(history: MessageRecord[]): string[] {
  return [...history]
    .reverse()
    .map(practiceMetaId)
    .filter((id): id is string => Boolean(id));
}

export function userRejectsPracticeOffer(text: string): boolean {
  return /(друг|инач|не\s+хочу|не\s+подходит|не\s+то|замен|альтернатив|another|different|not\s+this)/i.test(text);
}

export function lastAssistantOfferedPractice(history: MessageRecord[]): boolean {
  const lastAssistant = [...history].reverse().find((message) => message.role === "assistant");
  return Boolean(lastAssistant && practiceMetaId(lastAssistant));
}

export function shouldStayInPracticeSuggestion(params: {
  useCase: string;
  history: MessageRecord[];
  userMessage: string;
}): boolean {
  return (
    params.useCase === "daily_dialog" &&
    lastAssistantOfferedPractice(params.history) &&
    userRejectsPracticeOffer(params.userMessage)
  );
}

async function recentCompletedPracticeIds(
  db: SupabaseClient,
  userId: string,
  preferredKind: PracticeKind | null,
  limit: number,
): Promise<string[]> {
  const { data, error } = await db
    .from("practice_sessions")
    .select("practice_id,practice_slug,practices(kind)")
    .eq("user_id", userId)
    .not("ended_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(50);
  if (error) {
    console.warn("[dialog] Failed to load recent practice sessions", error.message);
    return [];
  }

  function inferredKind(item: { practice_slug: string; practices?: { kind?: string } | null }): string | null {
    if (item.practices?.kind) return item.practices.kind;
    if (BREATH_PRACTICE_SLUGS.has(item.practice_slug)) return "breath";
    if (item.practice_slug === STATIC_MEDITATION.slug) return "meditation";
    return null;
  }

  return ((data ?? []) as Array<{ practice_id: string | null; practice_slug: string; practices?: { kind?: string } | null }>)
    .filter((item) => !preferredKind || inferredKind(item) === preferredKind)
    .map((item) => item.practice_id ?? item.practice_slug)
    .filter(Boolean)
    .slice(0, limit);
}

function selectablePractice(practice: PracticeCandidate): SelectablePracticeCandidate {
  const params = practice.params && typeof practice.params === "object" ? practice.params : {};
  const paramsQuality = params.quality;
  const quality =
    typeof practice.rating === "number" && Number.isFinite(practice.rating)
      ? practice.rating
      : typeof paramsQuality === "number" && Number.isFinite(paramsQuality)
        ? paramsQuality
        : null;
  const recordedAt = typeof params.recorded_at === "string" ? params.recorded_at : null;

  return {
    id: practice.id,
    slug: practice.slug,
    kind: practice.kind,
    defaultDurationSec: practice.default_duration_sec,
    quality,
    recordedAt,
    chakraIds: (practice.practice_chakras ?? []).map((item) => Number(item.chakra_id)).filter((item) => Number.isInteger(item)),
    raw: practice,
  };
}

function withStaticPracticeFallbacks(
  practices: PracticeCandidate[],
  preferredKind: PracticeKind | null,
): PracticeCandidate[] {
  if (preferredKind && preferredKind !== "meditation") return practices;
  if (practices.some((practice) => practice.slug === STATIC_MEDITATION.slug)) return practices;
  return [...practices, STATIC_MEDITATION];
}

function launchForPractice(practice: PracticeCandidate, chakraId: number): PracticePickedPayload["launch"] {
  if (practice.kind === "breath") {
    return {
      route: "/breath-coherence",
      params: {
        practiceId: practice.slug,
        durationMs: String((practice.default_duration_sec ?? 600) * 1000),
        chakra: String(chakraId),
        launchSource: "assistant",
      },
    };
  }
  if (practice.kind === "meditation") {
    return {
      route: "/sacred-symbol-stream",
      params: {
        durationMs: String((practice.default_duration_sec ?? 300) * 1000),
        chakra: String(chakraId),
        launchSource: "assistant",
      },
    };
  }
  return {
    route: "/asana-practice",
    params: {
      practiceId: practice.id,
      ...(practice.default_duration_sec ? { durationMs: String(practice.default_duration_sec * 1000) } : {}),
      chakra: String(chakraId),
      launchSource: "assistant",
    },
  };
}

function toPracticePickedPayload(
  practice: PracticeCandidate,
  reason: string | null | undefined,
  chakraId: number,
  stack: PracticeCandidate[],
): PracticePickedPayload {
  const chakraIds = (practice.practice_chakras ?? [])
    .map((item) => Number(item.chakra_id))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 7);
  const params = practice.params && typeof practice.params === "object" ? practice.params : {};
  return {
    id: practice.id,
    slug: practice.slug,
    name: localizedTitle(practice.title, practice.slug),
    kind: practice.kind,
    reason,
    durationSec: practice.default_duration_sec,
    minDurationSec: practice.min_duration_sec ?? null,
    maxDurationSec: practice.max_duration_sec ?? null,
    chakraIds: chakraIds.length ? chakraIds : [chakraId],
    launch: launchForPractice(practice, chakraIds[0] ?? chakraId),
    hasDescription: hasLocalizedText(practice.description),
    hasInstructionVideo: Boolean(params.instruction_video || params.instruction_video_external_id || practice.video_external_id),
    video: practice.video_external_id
      ? {
          provider: "vimeo",
          externalId: practice.video_external_id,
          thumbnail: readPracticeVideoThumbnailFromParams(params),
        }
      : null,
    stack,
  };
}

export function publicPracticePickedPayload(practice: PracticePickedPayload, reason?: string | null) {
  const payload: PracticePickedPayload = { ...practice };
  delete payload.stack;
  return { ...payload, reason: practice.reason ?? reason };
}

function isDefaultPracticeMarker(marker: PracticePickMarker | null): boolean {
  const reason = marker?.reason?.toLowerCase() ?? "";
  return marker?.id === "default" || reason.includes("hard_cap_reached") || reason.includes("default_fallback");
}

export interface ChoosePracticeResult {
  picked: PracticePickedPayload;
  markerIdResolved: boolean | undefined;
  chakraId: number;
  preferredDurationMin: number | null;
}

export async function choosePractice(
  db: SupabaseClient,
  userId: string,
  marker: PracticePickMarker | null,
  context: PracticeSelectionContext,
  userMessage: string,
  history: MessageRecord[],
): Promise<ChoosePracticeResult | { picked: null; markerIdResolved: undefined; chakraId: number; preferredDurationMin: number | null }> {
  const planetToChakra: Record<string, number> = { Moon: 1, Venus: 2, Mars: 3, Jupiter: 4, Saturn: 5, Mercury: 6, Sun: 7 };
  const chakraId = planetToChakra[String(context.forecast?.planet_of_the_day ?? "Sun")] ?? 7;
  const allUserText = [
    ...history.filter((m) => m.role === "user").map((m) => m.content),
    userMessage,
  ].join(" ");
  const preferredDurationSec = inferPreferredDurationSec(allUserText);
  const preferredDurationMin = preferredDurationSec ? Math.round(preferredDurationSec / 60) : null;
  if (isDefaultPracticeMarker(marker)) {
    return { picked: toPracticePickedPayload(STATIC_COHERENT_BREATH, marker?.reason, chakraId, [STATIC_COHERENT_BREATH]), markerIdResolved: true, chakraId, preferredDurationMin };
  }
  const preferredKind = inferPreferredPracticeKind(allUserText);

  let query = db
    .from("practices")
    .select("id,slug,title,description,kind,default_duration_sec,min_duration_sec,max_duration_sec,rating,params,video_external_id,practice_chakras(chakra_id,weight)")
    .eq("is_active", true)
    .order("rating", { ascending: false, nullsFirst: false })
    .limit(200);
  if (preferredKind) query = query.eq("kind", preferredKind);

  const { data, error } = await query;
  if (error) throw error;

  const all = withStaticPracticeFallbacks((data ?? []) as PracticeCandidate[], preferredKind);
  const activePracticeCount = preferredKind ? all.length : 0;
  const recentLimit = recentStackLimitForKind(preferredKind, activePracticeCount);
  const recentIds = [
    ...(await recentCompletedPracticeIds(db, userId, preferredKind, recentLimit)),
    ...recentOfferedPracticeIds(history),
  ];
  const selection = selectPracticeCandidate({
    candidates: all.map(selectablePractice),
    preferredKind,
    chakraId,
    targetDurationSec: preferredDurationSec,
    recentIds,
    markerId: marker?.id,
  });
  if (!selection) return { picked: null, markerIdResolved: undefined, chakraId, preferredDurationMin };

  const markerIdResolved = selection.markerIdResolved;
  if (markerIdResolved === false) {
    console.warn(`[PRACTICE_SELECTOR] marker_id_not_found id=${marker?.id}`);
  }

  return {
    picked: toPracticePickedPayload(
      selection.picked.raw,
      marker?.reason,
      chakraId,
      selection.stack.map((practice) => practice.raw),
    ),
    markerIdResolved,
    chakraId,
    preferredDurationMin,
  };
}
