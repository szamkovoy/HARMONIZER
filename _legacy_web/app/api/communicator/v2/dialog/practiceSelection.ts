import type { SupabaseClient } from "@supabase/supabase-js";

import { getCoherenceBreathStrings } from "@/modules/breath/i18n/coherence";
import { asContentLocale, type AppContentLocale } from "@/modules/i18n/localeCodes";
import { getPracticeCatalogStrings } from "@/modules/practices/i18n/practices";
import type { PracticeRecommendation } from "@shared/recommendation";
import { readPracticeVideoThumbnailFromParams } from "@shared/practiceVideo";
import {
  recentStackLimitForKind,
  selectPracticeCandidate,
  type PracticeSelectorCandidate,
} from "@shared/selector";
import { type PracticePickMarker, type PracticeKindInferred, validateHistoryHasDurationAndType } from "@legacy/app/api/_utils/markers";
import type { MessageRecord } from "@legacy/app/api/communicator/v2/dialog/dialogHelpers";

type PracticeKind = PracticeKindInferred;

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

export type PracticePickedPayload = PracticeRecommendation & {
  stack?: PracticeCandidate[];
};

export type PracticeSelectionContext = {
  forecast?: {
    planet_of_the_day?: unknown;
    day_target_chakra?: unknown;
  } | null;
  user?: {
    locale?: string | null;
  } | null;
};

function localizedTitle(
  practice: PracticeCandidate,
  fallback: string,
  locale: string | null | undefined,
): string {
  const resolved = asContentLocale(locale) ?? "ru";
  const value = practice.title;
  if (practice.kind === "meditation" && practice.slug === STATIC_MEDITATION.slug) {
    return getPracticeCatalogStrings(resolved).meditationFlashTitle;
  }
  if (practice.kind === "breath") {
    const breathStrings = getCoherenceBreathStrings(resolved);
    const localized = breathStrings.practiceName[practice.slug as keyof typeof breathStrings.practiceName];
    if (typeof localized === "string" && localized.trim()) return localized.trim();
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return fallback;
  const requested = value?.[resolved as AppContentLocale];
  if (typeof requested === "string" && requested.trim()) return requested.trim();
  return value?.en?.trim() || value?.ru?.trim() || fallback;
}

function hasLocalizedText(value: PracticeCandidate["description"]): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (!value || typeof value !== "object") return false;
  return Boolean(value?.ru?.trim() || value?.en?.trim());
}


function practiceMetaId(message: MessageRecord): string | null {
  const meta = message.meta as { practicePicked?: { id?: unknown }; practice_picked?: { id?: unknown } } | null;
  const id = meta?.practicePicked?.id ?? meta?.practice_picked?.id;
  return typeof id === "string" && id.trim() ? id : null;
}

/** Map `practice_id`, `practice_slug`, or message meta hint to the catalog row's canonical `id`. */
export function resolvePracticeKeyToCatalogId(hint: string, catalog: PracticeCandidate[]): string | null {
  const t = hint.trim();
  if (!t) return null;
  const row = catalog.find((p) => p.id === t || p.slug === t);
  return row?.id ?? null;
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
  return history.some((message) => message.role === "assistant" && practiceMetaId(message));
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
  catalog: PracticeCandidate[],
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

  const breathSlugs = new Set(catalog.filter((p) => p.kind === "breath").map((p) => p.slug));

  function inferredKind(item: { practice_slug: string; practices?: { kind?: string } | null }): string | null {
    if (item.practices?.kind) return item.practices.kind;
    if (breathSlugs.has(item.practice_slug)) return "breath";
    if (item.practice_slug === STATIC_MEDITATION.slug) return "meditation";
    return null;
  }

  const filtered = ((data ?? []) as Array<{ practice_id: string | null; practice_slug: string; practices?: { kind?: string } | null }>)
    .filter((item) => !preferredKind || inferredKind(item) === preferredKind);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of filtered) {
    if (out.length >= limit) break;
    const hint = item.practice_id ?? item.practice_slug;
    const canon = resolvePracticeKeyToCatalogId(String(hint), catalog);
    if (!canon || seen.has(canon)) continue;
    seen.add(canon);
    out.push(canon);
  }
  return out;
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

/** Статические практики ассистента для резолва `[PRACTICE_PICK]` по полному каталогу (все kind). */
function mergeStaticPracticesForMarkerLookup(practices: PracticeCandidate[]): PracticeCandidate[] {
  const out = [...practices];
  if (!out.some((practice) => practice.slug === STATIC_MEDITATION.slug)) out.push(STATIC_MEDITATION);
  if (!out.some((practice) => practice.slug === STATIC_COHERENT_BREATH.slug)) out.push(STATIC_COHERENT_BREATH);
  return out;
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
  locale: string | null | undefined,
): PracticePickedPayload {
  const chakraIds = (practice.practice_chakras ?? [])
    .map((item) => Number(item.chakra_id))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 7);
  const params = practice.params && typeof practice.params === "object" ? practice.params : {};
  return {
    id: practice.id,
    slug: practice.slug,
    name: localizedTitle(practice, practice.slug, locale),
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
  /** Kind практики, на которую указывал маркер до любых правок (если id резолвился в каталог). */
  markerCatalogPracticeKind?: PracticeKind | null;
  /** История уверенно задала тип, а маркер указывал на другой kind — id маркера сброшен, выбор по истории. */
  historyKindConflictResolved?: boolean;
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
  const fixedTarget = Number(context.forecast?.day_target_chakra);
  const chakraId = Number.isInteger(fixedTarget) && fixedTarget >= 1 && fixedTarget <= 7
    ? fixedTarget
    : planetToChakra[String(context.forecast?.planet_of_the_day ?? "Sun")] ?? 7;
  const validation = validateHistoryHasDurationAndType([
    ...history.filter((m) => m.role === "user"),
    { role: "user" as const, content: userMessage },
  ]);
  const preferredDurationSec = validation.durationSec;
  const preferredDurationMin = preferredDurationSec ? Math.round(preferredDurationSec / 60) : null;
  const workingMarker: PracticePickMarker | null = marker ? { ...marker } : null;
  const preferredKind = validation.practiceKind;
  if (isDefaultPracticeMarker(workingMarker) && !preferredKind) {
    return {
      picked: toPracticePickedPayload(
        STATIC_COHERENT_BREATH,
        workingMarker?.reason,
        chakraId,
        [STATIC_COHERENT_BREATH],
        context.user?.locale,
      ),
      markerIdResolved: true,
      chakraId,
      preferredDurationMin,
      markerCatalogPracticeKind: "breath",
      historyKindConflictResolved: false,
    };
  }
  if (isDefaultPracticeMarker(workingMarker) && preferredKind) {
    workingMarker!.id = "";
  }
  const hasExplicitMarker = Boolean(workingMarker?.id?.trim()) && !isDefaultPracticeMarker(workingMarker);

  let query = db
    .from("practices")
    .select("id,slug,title,description,kind,default_duration_sec,min_duration_sec,max_duration_sec,rating,params,video_external_id,practice_chakras(chakra_id,weight)")
    .eq("is_active", true)
    .order("rating", { ascending: false, nullsFirst: false })
    .limit(200);
  if (!hasExplicitMarker && preferredKind) query = query.eq("kind", preferredKind);

  const { data, error } = await query;
  if (error) throw error;

  let rawRows = (data ?? []) as PracticeCandidate[];

  let selectionPreferredKind = preferredKind;
  let markerCatalogPracticeKind: PracticeKind | null = null;
  let historyKindConflictResolved = false;
  if (hasExplicitMarker && workingMarker) {
    const markerPool = mergeStaticPracticesForMarkerLookup(rawRows);
    const markerHit = markerPool
      .map(selectablePractice)
      .find((row) => row.id === workingMarker.id || row.slug === workingMarker.id);
    if (!markerHit) {
      console.warn(`[PRACTICE_SELECTOR] marker_id_not_in_catalog id=${workingMarker.id} — fallback to inferred kind`);
      rawRows = preferredKind ? rawRows.filter((row) => row.kind === preferredKind) : rawRows;
    } else {
      markerCatalogPracticeKind = markerHit.raw.kind;
      if (validation.confident && preferredKind && markerHit.raw.kind !== preferredKind) {
        historyKindConflictResolved = true;
        workingMarker.id = "";
        selectionPreferredKind = preferredKind;
      } else if (!preferredKind || markerHit.raw.kind !== preferredKind) {
        selectionPreferredKind = markerHit.raw.kind;
      }
    }
  }

  const all = withStaticPracticeFallbacks(rawRows, selectionPreferredKind);
  const activePracticeCount = selectionPreferredKind
    ? all.filter((row) => row.kind === selectionPreferredKind).length
    : all.length;
  if (selectionPreferredKind && activePracticeCount === 0) {
    console.warn(
      `[PRACTICE_SELECTOR_EMPTY_CATALOG] ${JSON.stringify({
        preferredKind: selectionPreferredKind,
        chakraId,
        preferredDurationMin,
        hasExplicitMarker,
        markerId: workingMarker?.id ?? null,
      })}`,
    );
  }
  const recentLimit = recentStackLimitForKind(selectionPreferredKind, activePracticeCount);
  const recentCompletedCanon = await recentCompletedPracticeIds(db, userId, selectionPreferredKind, recentLimit, all);
  const recentOfferedCanon = recentOfferedPracticeIds(history)
    .map((hint) => resolvePracticeKeyToCatalogId(hint, all))
    .filter((id): id is string => Boolean(id));
  const recentIds = [...recentCompletedCanon, ...recentOfferedCanon];
  const markerIdForSelection =
    workingMarker?.id?.trim() && !isDefaultPracticeMarker(workingMarker)
      ? resolvePracticeKeyToCatalogId(workingMarker.id.trim(), all) ?? undefined
      : undefined;
  const selection = selectPracticeCandidate({
    candidates: all.map(selectablePractice),
    preferredKind: selectionPreferredKind,
    chakraId,
    targetDurationSec: preferredDurationSec,
    recentIds,
    markerId: markerIdForSelection,
  });
  if (!selection) {
    console.warn(
      `[PRACTICE_SELECTOR_EMPTY_RESULT] ${JSON.stringify({
        preferredKind: selectionPreferredKind,
        chakraId,
        preferredDurationMin,
        candidateCount: all.length,
        activePracticeCount,
        recentIdsCount: recentIds.length,
        markerIdForSelection: markerIdForSelection ?? null,
      })}`,
    );
    return { picked: null, markerIdResolved: undefined, chakraId, preferredDurationMin };
  }

  const markerIdResolved = selection.markerIdResolved;
  if (markerIdResolved === false) {
    console.warn(`[PRACTICE_SELECTOR] marker_id_not_found id=${marker?.id}`);
  }

  return {
    picked: toPracticePickedPayload(
      selection.picked.raw,
      workingMarker?.reason ?? marker?.reason,
      chakraId,
      selection.stack.map((practice) => practice.raw),
      context.user?.locale,
    ),
    markerIdResolved,
    chakraId,
    preferredDurationMin,
    markerCatalogPracticeKind,
    historyKindConflictResolved,
  };
}
