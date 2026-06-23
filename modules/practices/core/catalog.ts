import { BREATH_PRACTICES, DEFAULT_CHAKRA, isChakra } from "@/modules/breath";
import type { BreathPracticeId, Chakra } from "@/modules/breath";
import { getCoherenceBreathStrings } from "@/modules/breath/i18n/coherence";
import { asContentLocale, inlineBaseLocale, SOURCE_LOCALE } from "@/modules/i18n/localeCodes";
import { getPracticeCatalogStrings, type PracticeLocale } from "@/modules/practices/i18n/practices";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";
import { getSupabase, requireSupabase } from "@/services/supabase";
import type { Database, Json } from "@/services/supabase-types";
import { readPracticeVideoThumbnailFromParams } from "@shared/practiceVideo";

import type {
  PracticeCatalog,
  PracticeCatalogFilters,
  PracticeDurationPolicy,
  PracticeKind,
  PracticeSummary,
} from "./types";
import { sortPracticeCandidatesForCatalog } from "@shared/selector";

type PracticeRow = Database["public"]["Tables"]["practices"]["Row"];
type PracticeChakraRow = Database["public"]["Tables"]["practice_chakras"]["Row"];
type YogaCatalogChakraRow = Pick<PracticeChakraRow, "chakra_id" | "is_primary" | "weight">;
type YogaCatalogRow = Pick<
  PracticeRow,
  "id" | "slug" | "title" | "default_duration_sec" | "rating" | "video_provider" | "video_external_id"
> & {
  params?: PracticeRow["params"];
  video_thumbnail?: Json | null;
  chakra_ids?: Json | null;
  primary_chakra_id?: number | null;
  recorded_at?: string | null;
  practice_chakras?: YogaCatalogChakraRow[] | null;
};

export type LateYogaPracticesResult = {
  practices: PracticeSummary[];
  state: "ready" | "timeout" | "error";
  errorMessage?: string;
};

const BREATH_DEFAULT_DURATION_SEC = 10 * 60;
const YOGA_CATALOG_TIMEOUT_MS = 30_000;

const BREATH_PRIMARY_CHAKRA: Record<string, Chakra> = {
  coherent: 4,
  "nadi-shodhana": 6,
  "surya-bhedana": 3,
  "chandra-bhedana": 2,
  square: 1,
  "triangle-up": 5,
  "triangle-down": 4,
};

function jsonRecord(value: Json | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function localizedText(value: Json | null, fallback: string, locale: PracticeLocale = "ru"): string {
  const record = jsonRecord(value);
  const code = asContentLocale(locale) ?? SOURCE_LOCALE;
  const localized = record[code];
  if (typeof localized === "string" && localized.trim()) return localized.trim();
  const en = record.en;
  if (typeof en === "string" && en.trim()) return en.trim();
  const ru = record.ru;
  if (typeof ru === "string" && ru.trim()) return ru.trim();
  return fallback;
}

function stripImportedYogaSuffix(title: string): string {
  return title.replace(/((?:^|[\s:])\d+_\d{4})_[^\s:]+$/u, "$1").trim();
}

function optionalPositiveNumber(value: number | null): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function formatPracticeCatalogError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.details, record.hint, record.code]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());
    if (parts.length) return parts.join(" | ");
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function durationPolicyFromParams(params: Record<string, unknown>, kind: PracticeKind): PracticeDurationPolicy {
  return params.duration_policy === "fixed" || kind === "yoga" ? "fixed" : "user_selectable";
}

function chakrasFromParams(params: Record<string, unknown>): YogaCatalogChakraRow[] {
  const rawIds = params.chakra_ids;
  if (!Array.isArray(rawIds)) return [];
  const primaryId = typeof params.primary_chakra_id === "number" ? params.primary_chakra_id : rawIds[0];
  return rawIds
    .filter((value): value is number => typeof value === "number" && isChakra(value))
    .map((chakraId) => ({
      chakra_id: chakraId,
      is_primary: chakraId === primaryId,
      weight: chakraId === primaryId ? 1 : 0.7,
    }));
}

function yogaRowParams(row: YogaCatalogRow): Record<string, unknown> {
  const params = jsonRecord(row.params ?? null);
  if (Object.keys(params).length > 0) return params;
  return {
    ...(row.video_thumbnail ? { video_thumbnail: row.video_thumbnail } : {}),
    ...(row.chakra_ids ? { chakra_ids: row.chakra_ids } : {}),
    ...(typeof row.primary_chakra_id === "number" ? { primary_chakra_id: row.primary_chakra_id } : {}),
    ...(typeof row.recorded_at === "string" && row.recorded_at.trim() ? { recorded_at: row.recorded_at } : {}),
  };
}

function yogaChakraRows(
  row: { params?: PracticeRow["params"] },
  embedded: YogaCatalogChakraRow[] | null | undefined,
): YogaCatalogChakraRow[] {
  if (embedded?.length) return embedded;
  return chakrasFromParams(jsonRecord(row.params ?? null));
}

function primaryChakraFor(rows: readonly YogaCatalogChakraRow[]): Chakra | undefined {
  const primary = rows.find((row) => row.is_primary && isChakra(row.chakra_id));
  if (primary && isChakra(primary.chakra_id)) return primary.chakra_id;
  const first = rows.find((row) => isChakra(row.chakra_id));
  return first && isChakra(first.chakra_id) ? first.chakra_id : undefined;
}

/** Короткие описания в каталоге; подзаголовок с санскритом остаётся отдельной строкой. */
function createStaticMeditations(locale: PracticeLocale): PracticeSummary[] {
  const copy = getPracticeCatalogStrings(locale);
  return [
    {
      id: "meditation:sacred-symbol-stream",
      slug: "sacred-symbol-stream",
      kind: "meditation",
      title: copy.meditationFlashTitle,
      subtitle: copy.meditationFlashSubtitle,
      description: copy.meditationFlashDescription,
      defaultDurationSec: 3 * 60,
      minDurationSec: 1 * 60,
      maxDurationSec: 5 * 60,
      durationPolicy: "user_selectable",
      chakraIds: [1, 6, 7],
      primaryChakra: 1,
      source: "static",
      params: {
        duration_policy: "user_selectable",
        source: "static_meditation",
      },
      launch: {
        kind: "meditation",
        route: "/sacred-symbol-stream",
        practiceId: "sacred-symbol-stream",
        durationMs: 3 * 60_000,
        chakra: 1,
      },
    },
  ];
}

function createBreathPractices(locale: PracticeLocale): PracticeSummary[] {
  const strings = getCoherenceBreathStrings(locale);
  const copy = getPracticeCatalogStrings(locale);
  return BREATH_PRACTICES.map((practice) => {
    const primaryChakra = BREATH_PRIMARY_CHAKRA[practice.id] ?? DEFAULT_CHAKRA;
    const title = strings.practiceName[practice.id];
    const subtitle = strings.practiceSanskritName[practice.id];
    return {
      id: `breath:${practice.id}`,
      slug: practice.id,
      kind: "breath",
      title,
      subtitle,
      description: copy.breathDescriptions[practice.id],
      defaultDurationSec: BREATH_DEFAULT_DURATION_SEC,
      minDurationSec: 5 * 60,
      maxDurationSec: 20 * 60,
      durationPolicy: "user_selectable",
      chakraIds: [primaryChakra],
      primaryChakra,
      source: "breath_catalog",
      params: {
        indicatorKind: practice.indicatorKind,
        channelMode: practice.channelMode,
        normalBaseBeats: practice.normalBaseBeats,
        duration_policy: "user_selectable",
      },
      launch: {
        kind: "breath",
        route: "/breath-coherence",
        practiceId: practice.id,
        durationMs: BREATH_DEFAULT_DURATION_SEC * 1000,
        chakra: primaryChakra,
        usePulseSensor: true,
      },
    };
  });
}

export function resolveYogaPracticeTitle(
  value: Json | null,
  fallback: string,
  locale: PracticeLocale = "ru",
): string {
  const rawTitle = localizedText(value, fallback, locale).trim();
  const title = stripImportedYogaSuffix(rawTitle);
  const practiceWord = getPracticeCatalogStrings(locale).yogaTitlePrefix;
  const colonIndex = title.indexOf(":");
  if (colonIndex > 0) {
    const tail = title.slice(colonIndex + 1).trim();
    if (/\d+_\d{4}/.test(tail)) return `${practiceWord}: ${tail}`;
  }
  if (locale === SOURCE_LOCALE) return title.replace(/^Пробуждение/i, practiceWord).trim();
  if (inlineBaseLocale(locale) === "en") return title.replace(/^Awakening/i, practiceWord).trim();
  return title;
}

function yogaPracticeFromRow(row: YogaCatalogRow, locale: PracticeLocale): PracticeSummary {
  const params = yogaRowParams(row);
  const chakraRows = yogaChakraRows(row, row.practice_chakras);
  const chakraIds = chakraRows.map((item) => item.chakra_id).filter(isChakra);
  const primaryChakra = primaryChakraFor(chakraRows);
  const durationPolicy = durationPolicyFromParams(params, "yoga");
  const defaultDurationSec = optionalPositiveNumber(row.default_duration_sec);
  const video =
    row.video_provider || row.video_external_id
      ? {
          provider: row.video_provider ?? "vimeo",
          externalId: row.video_external_id ?? undefined,
          thumbnail: readPracticeVideoThumbnailFromParams(params),
        }
      : undefined;

  return {
    id: row.id,
    slug: row.slug,
    kind: "yoga",
    title: resolveYogaPracticeTitle(row.title, row.slug, locale),
    defaultDurationSec,
    durationPolicy,
    chakraIds,
    primaryChakra,
    quality: typeof row.rating === "number" && Number.isFinite(row.rating) ? row.rating : undefined,
    recordedAt: optionalString(params.recorded_at),
    source: "supabase",
    video,
    params,
    launch: {
      kind: "yoga",
      route: "/asana-practice",
      practiceId: row.id,
      durationMs: defaultDurationSec ? defaultDurationSec * 1000 : undefined,
      chakra: primaryChakra,
    },
  };
}

export function sortPracticesForCatalog(practices: PracticeSummary[]): PracticeSummary[] {
  return sortPracticeCandidatesForCatalog(practices);
}

export function filterPractices(practices: PracticeSummary[], filters: PracticeCatalogFilters): PracticeSummary[] {
  return sortPracticesForCatalog(
    practices.filter((practice) => {
      if (filters.chakra && filters.chakra !== "any" && !practice.chakraIds.includes(filters.chakra)) {
        return false;
      }
      if (!filters.duration || filters.duration === "any") return true;

      const seconds = practice.defaultDurationSec;
      if (!seconds) return practice.durationPolicy === "user_selectable";
      if (filters.duration === "short") return seconds <= 30 * 60;
      if (filters.duration === "medium") return seconds > 30 * 60 && seconds <= 45 * 60;
      return seconds > 45 * 60;
    }),
  );
}

export async function loadYogaPractices(locale: PracticeLocale = "ru"): Promise<PracticeSummary[]> {
  const supabase = getSupabase() ?? requireSupabase();

  const startedAt = Date.now();
  logRuntimeEvent("practice_catalog:yoga_load_start", undefined, "debug");
  const { data: practices, error } = await supabase
    .from("practices")
    .select(
      "id,slug,title,default_duration_sec,rating,video_provider,video_external_id,video_thumbnail:params->video_thumbnail,chakra_ids:params->chakra_ids,primary_chakra_id:params->primary_chakra_id,recorded_at:params->recorded_at,practice_chakras(chakra_id,is_primary,weight)",
    )
    .eq("kind", "yoga")
    .eq("is_active", true)
    .order("rating", { ascending: false, nullsFirst: false });

  if (error) {
    logRuntimeEvent(
      "practice_catalog:yoga_load_error",
      { durationMs: Date.now() - startedAt, error: error.message },
      "warn",
    );
    throw error;
  }
  if (!practices?.length) {
    logRuntimeEvent(
      "practice_catalog:yoga_load_empty",
      { durationMs: Date.now() - startedAt, error: null },
      "debug",
    );
    return [];
  }

  const yogaRows = (practices ?? []) as YogaCatalogRow[];
  const result = sortPracticesForCatalog(yogaRows.map((row) => yogaPracticeFromRow(row, locale)));
  logRuntimeEvent("practice_catalog:yoga_load_ready", {
    durationMs: Date.now() - startedAt,
    practiceCount: result.length,
    chakraRows: yogaRows.reduce((count, row) => count + (row.practice_chakras?.length ?? 0), 0),
  });
  return result;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  label: string,
): Promise<{ value: T; timedOut: boolean }> {
  return Promise.race([
    promise.then((value) => ({ value, timedOut: false })),
    new Promise<{ value: T; timedOut: boolean }>((resolve) => {
      const id = setTimeout(() => {
        logRuntimeEvent(`${label}:timeout`, { timeoutMs }, "warn");
        resolve({ value: fallback, timedOut: true });
      }, timeoutMs);
      promise.finally(() => clearTimeout(id)).catch(() => clearTimeout(id));
    }),
  ]);
}

type LoadPracticeCatalogOptions = {
  locale?: PracticeLocale;
  initialYoga?: PracticeSummary[];
  onLateYogaPractices?: (result: LateYogaPracticesResult) => void;
};

type LoadPracticeCatalogDeps = {
  loadYogaPractices?: (locale?: PracticeLocale) => Promise<PracticeSummary[]>;
};

export async function loadPracticeCatalog(
  options?: LoadPracticeCatalogOptions,
  deps?: LoadPracticeCatalogDeps,
): Promise<PracticeCatalog> {
  const startedAt = Date.now();
  const locale: PracticeLocale = options?.locale ?? "ru";
  const initialYoga = options?.initialYoga ?? [];
  logRuntimeEvent("practice_catalog:load_start", undefined, "debug");
  const meditation = sortPracticesForCatalog(createStaticMeditations(locale));
  const breath = sortPracticesForCatalog(createBreathPractices(locale));
  const yogaLoader = deps?.loadYogaPractices ?? loadYogaPractices;
  const yogaPromise = yogaLoader(locale);

  if (options?.onLateYogaPractices) {
    const onLateYogaPractices = options.onLateYogaPractices;
    void (async () => {
      const { value: yoga, timedOut } = await withTimeout(
        yogaPromise,
        YOGA_CATALOG_TIMEOUT_MS,
        [],
        "practice_catalog:yoga_load",
      );
      if (timedOut) {
        logRuntimeEvent("practice_catalog:yoga_load_late_timeout", { timeoutMs: YOGA_CATALOG_TIMEOUT_MS }, "warn");
        onLateYogaPractices({ practices: [], state: "timeout" });
        yogaPromise
          .then((finalYoga) => {
            logRuntimeEvent("practice_catalog:yoga_load_late_ready", {
              yogaCount: finalYoga.length,
              afterTimeout: true,
            });
            onLateYogaPractices({ practices: finalYoga, state: "ready" });
          })
          .catch((error: unknown) => {
            const errorMessage = formatPracticeCatalogError(error);
            logRuntimeEvent(
              "practice_catalog:yoga_load_late_error",
              { message: errorMessage, afterTimeout: true },
              "warn",
            );
            onLateYogaPractices({
              practices: [],
              state: "error",
              errorMessage,
            });
          });
        return;
      }
      logRuntimeEvent("practice_catalog:yoga_load_late_ready", {
        yogaCount: yoga.length,
        timedOut,
      });
      onLateYogaPractices({ practices: yoga, state: "ready" });
    })().catch((error: unknown) => {
      const errorMessage = formatPracticeCatalogError(error);
      logRuntimeEvent(
        "practice_catalog:yoga_load_late_error",
        { message: errorMessage },
        "warn",
      );
      onLateYogaPractices({
        practices: [],
        state: "error",
        errorMessage,
      });
    });
    logRuntimeEvent("practice_catalog:load_ready", {
      durationMs: Date.now() - startedAt,
      meditationCount: meditation.length,
      breathCount: breath.length,
      yogaCount: initialYoga.length,
      yogaDeferred: true,
    });
    return {
      meditation,
      breath,
      yoga: initialYoga,
    };
  }

  const { value: yoga, timedOut } = await withTimeout(
    yogaPromise,
    YOGA_CATALOG_TIMEOUT_MS,
    [],
    "practice_catalog:yoga_load",
  );
  logRuntimeEvent("practice_catalog:load_ready", {
    durationMs: Date.now() - startedAt,
    meditationCount: meditation.length,
    breathCount: breath.length,
    yogaCount: yoga.length,
  });
  return {
    meditation,
    breath,
    yoga,
  };
}
