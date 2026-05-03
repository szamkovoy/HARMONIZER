import { BREATH_PRACTICES, DEFAULT_CHAKRA, isChakra } from "@/modules/breath";
import type { Chakra } from "@/modules/breath";
import { getCoherenceBreathStrings } from "@/modules/breath/i18n/coherence";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";
import { getSupabase } from "@/services/supabase";
import type { Database, Json } from "@/services/supabase-types";

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

const BREATH_DEFAULT_DURATION_SEC = 10 * 60;
const YOGA_CATALOG_TIMEOUT_MS = 12_000;

const BREATH_PRIMARY_CHAKRA: Record<string, Chakra> = {
  coherent: 4,
  "nadi-shodhana": 6,
  "surya-bhedana": 3,
  "chandra-bhedana": 2,
  square: 1,
  "triangle-up": 5,
  "triangle-down": 4,
};

const STATIC_MEDITATIONS: PracticeSummary[] = [
  {
    id: "meditation:sacred-symbol-stream",
    slug: "sacred-symbol-stream",
    kind: "meditation",
    title: "Вспышка",
    subtitle: "Поток сакральных символов",
    description: "Короткая визуальная медитация для мягкого переключения внимания и гармонизации.",
    defaultDurationSec: 5 * 60,
    minDurationSec: 1 * 60,
    maxDurationSec: 10 * 60,
    durationPolicy: "user_selectable",
    chakraIds: [6, 7],
    primaryChakra: 6,
    source: "static",
    params: {
      duration_policy: "user_selectable",
      source: "static_meditation",
    },
    launch: {
      kind: "meditation",
      route: "/sacred-symbol-stream",
      practiceId: "sacred-symbol-stream",
      durationMs: 5 * 60_000,
      chakra: 6,
    },
  },
];

function jsonRecord(value: Json | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function localizedText(value: Json | null, fallback: string): string {
  const record = jsonRecord(value);
  const ru = record.ru;
  const en = record.en;
  if (typeof ru === "string" && ru.trim()) return ru.trim();
  if (typeof en === "string" && en.trim()) return en.trim();
  return fallback;
}

function optionalPositiveNumber(value: number | null): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function durationPolicyFromParams(params: Record<string, unknown>, kind: PracticeKind): PracticeDurationPolicy {
  return params.duration_policy === "fixed" || kind === "yoga" ? "fixed" : "user_selectable";
}

function primaryChakraFor(rows: PracticeChakraRow[]): Chakra | undefined {
  const primary = rows.find((row) => row.is_primary && isChakra(row.chakra_id));
  if (primary && isChakra(primary.chakra_id)) return primary.chakra_id;
  const first = rows.find((row) => isChakra(row.chakra_id));
  return first && isChakra(first.chakra_id) ? first.chakra_id : undefined;
}

function createBreathPractices(): PracticeSummary[] {
  const strings = getCoherenceBreathStrings("ru");
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
      description: subtitle ? `${subtitle}. Дыхательная практика с биологической обратной связью.` : undefined,
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

function displayYogaTitle(title: string): string {
  return title
    .replace(/^Пробуждение/i, "Практика")
    .replace(/(_\d{4})_и.*$/i, "$1")
    .trim();
}

function yogaPracticeFromRow(row: PracticeRow, chakraRows: PracticeChakraRow[]): PracticeSummary | null {
  if (row.kind !== "yoga") return null;

  const params = jsonRecord(row.params);
  const chakraIds = chakraRows.map((item) => item.chakra_id).filter(isChakra);
  const primaryChakra = primaryChakraFor(chakraRows);
  const durationPolicy = durationPolicyFromParams(params, "yoga");
  const defaultDurationSec = optionalPositiveNumber(row.default_duration_sec);
  const video =
    row.video_provider || row.video_url || row.video_external_id
      ? {
          provider: row.video_provider ?? "vimeo",
          url: row.video_url ?? undefined,
          externalId: row.video_external_id ?? undefined,
        }
      : undefined;

  return {
    id: row.id,
    slug: row.slug,
    kind: "yoga",
    title: displayYogaTitle(localizedText(row.title, row.slug)),
    description: localizedText(row.description, ""),
    defaultDurationSec,
    minDurationSec: optionalPositiveNumber(row.min_duration_sec),
    maxDurationSec: optionalPositiveNumber(row.max_duration_sec),
    durationPolicy,
    chakraIds,
    primaryChakra,
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

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function loadYogaPractices(): Promise<PracticeSummary[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const startedAt = Date.now();
  logRuntimeEvent("practice_catalog:yoga_load_start", undefined, "debug");
  const { data: practices, error } = await supabase
    .from("practices")
    .select(
      "id,slug,kind,title,description,default_duration_sec,min_duration_sec,max_duration_sec,params,video_provider,video_url,video_external_id,rating,is_active,version,created_at,updated_at",
    )
    .eq("kind", "yoga")
    .eq("is_active", true)
    .order("rating", { ascending: false, nullsFirst: false });

  if (error || !practices?.length) {
    logRuntimeEvent(
      "practice_catalog:yoga_load_empty",
      { durationMs: Date.now() - startedAt, error: error?.message ?? null },
      error ? "warn" : "debug",
    );
    return [];
  }

  const ids = practices.map((practice) => practice.id);
  const chakraRows: PracticeChakraRow[] = [];
  for (const chunk of chunks(ids, 80)) {
    const { data } = await supabase
      .from("practice_chakras")
      .select("practice_id,chakra_id,is_primary,weight")
      .in("practice_id", chunk);
    chakraRows.push(...((data ?? []) as PracticeChakraRow[]));
  }

  const result = sortPracticesForCatalog(practices
    .map((practice) =>
      yogaPracticeFromRow(
        practice,
        (chakraRows ?? []).filter((row) => row.practice_id === practice.id),
      ),
    )
    .filter((practice): practice is PracticeSummary => practice !== null));
  logRuntimeEvent("practice_catalog:yoga_load_ready", {
    durationMs: Date.now() - startedAt,
    practiceCount: result.length,
    chakraRows: chakraRows.length,
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

export async function loadPracticeCatalog(options?: {
  onLateYogaPractices?: (practices: PracticeSummary[]) => void;
}): Promise<PracticeCatalog> {
  const startedAt = Date.now();
  logRuntimeEvent("practice_catalog:load_start", undefined, "debug");
  const yogaPromise = loadYogaPractices();
  const { value: yoga, timedOut } = await withTimeout(
    yogaPromise,
    YOGA_CATALOG_TIMEOUT_MS,
    [],
    "practice_catalog:yoga_load",
  );
  if (timedOut && options?.onLateYogaPractices) {
    yogaPromise
      .then((lateYoga) => {
        logRuntimeEvent("practice_catalog:yoga_load_late_ready", { yogaCount: lateYoga.length });
        options.onLateYogaPractices?.(lateYoga);
      })
      .catch((error: unknown) => {
        logRuntimeEvent(
          "practice_catalog:yoga_load_late_error",
          { message: error instanceof Error ? error.message : String(error) },
          "warn",
        );
      });
  }
  logRuntimeEvent("practice_catalog:load_ready", {
    durationMs: Date.now() - startedAt,
    meditationCount: STATIC_MEDITATIONS.length,
    breathCount: BREATH_PRACTICES.length,
    yogaCount: yoga.length,
  });
  return {
    meditation: sortPracticesForCatalog(STATIC_MEDITATIONS),
    breath: sortPracticesForCatalog(createBreathPractices()),
    yoga,
  };
}
