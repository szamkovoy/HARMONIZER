import { BREATH_PRACTICES, DEFAULT_CHAKRA, isChakra } from "@/modules/breath";
import type { Chakra } from "@/modules/breath";
import { getCoherenceBreathStrings } from "@/modules/breath/i18n/coherence";
import { getSupabase } from "@/services/supabase";
import type { Database, Json } from "@/services/supabase-types";

import type {
  PracticeCatalog,
  PracticeCatalogFilters,
  PracticeDurationPolicy,
  PracticeKind,
  PracticeSummary,
} from "./types";

type PracticeRow = Database["public"]["Tables"]["practices"]["Row"];
type PracticeChakraRow = Database["public"]["Tables"]["practice_chakras"]["Row"];

const BREATH_DEFAULT_DURATION_SEC = 10 * 60;

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
    description: "Короткая визуальная медитация для мягкого переключения внимания и настройки на внутренний образ.",
    defaultDurationSec: 5 * 60,
    durationPolicy: "fixed",
    chakraIds: [6, 7],
    primaryChakra: 6,
    quality: 3,
    source: "static",
    params: {
      duration_policy: "fixed",
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
      minDurationSec: 2 * 60,
      maxDurationSec: 30 * 60,
      durationPolicy: "user_selectable",
      chakraIds: [primaryChakra],
      primaryChakra,
      quality: 3,
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
      },
    };
  });
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
    title: localizedText(row.title, row.slug),
    description: localizedText(row.description, ""),
    defaultDurationSec,
    minDurationSec: optionalPositiveNumber(row.min_duration_sec),
    maxDurationSec: optionalPositiveNumber(row.max_duration_sec),
    durationPolicy,
    chakraIds,
    primaryChakra,
    quality: optionalPositiveNumber(row.rating),
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

function durationRank(seconds: number | undefined): number {
  if (!seconds) return Number.MAX_SAFE_INTEGER;
  if (seconds <= 10 * 60) return 1;
  if (seconds <= 25 * 60) return 2;
  return 3;
}

export function sortPracticesForCatalog(practices: PracticeSummary[]): PracticeSummary[] {
  return [...practices].sort((a, b) => {
    const qualityDelta = (b.quality ?? 3) - (a.quality ?? 3);
    if (qualityDelta !== 0) return qualityDelta;

    const recordedA = a.recordedAt ? Date.parse(a.recordedAt) : Number.POSITIVE_INFINITY;
    const recordedB = b.recordedAt ? Date.parse(b.recordedAt) : Number.POSITIVE_INFINITY;
    const normalizedRecordedA = Number.isFinite(recordedA) ? recordedA : Number.POSITIVE_INFINITY;
    const normalizedRecordedB = Number.isFinite(recordedB) ? recordedB : Number.POSITIVE_INFINITY;
    if (normalizedRecordedA !== normalizedRecordedB) return normalizedRecordedA - normalizedRecordedB;

    const durationDelta = durationRank(a.defaultDurationSec) - durationRank(b.defaultDurationSec);
    if (durationDelta !== 0) return durationDelta;
    return a.title.localeCompare(b.title, "ru");
  });
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
      if (filters.duration === "short") return seconds <= 10 * 60;
      if (filters.duration === "medium") return seconds > 10 * 60 && seconds <= 25 * 60;
      return seconds > 25 * 60;
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

async function loadYogaPractices(): Promise<PracticeSummary[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data: practices, error } = await supabase
    .from("practices")
    .select(
      "id,slug,kind,title,description,default_duration_sec,min_duration_sec,max_duration_sec,params,video_provider,video_url,video_external_id,rating,is_active,version,created_at,updated_at",
    )
    .eq("kind", "yoga")
    .eq("is_active", true)
    .order("rating", { ascending: false, nullsFirst: false });

  if (error || !practices?.length) return [];

  const ids = practices.map((practice) => practice.id);
  const chakraRows: PracticeChakraRow[] = [];
  for (const chunk of chunks(ids, 80)) {
    const { data } = await supabase
      .from("practice_chakras")
      .select("practice_id,chakra_id,is_primary,weight")
      .in("practice_id", chunk);
    chakraRows.push(...((data ?? []) as PracticeChakraRow[]));
  }

  return sortPracticesForCatalog(practices
    .map((practice) =>
      yogaPracticeFromRow(
        practice,
        (chakraRows ?? []).filter((row) => row.practice_id === practice.id),
      ),
    )
    .filter((practice): practice is PracticeSummary => practice !== null));
}

export async function loadPracticeCatalog(): Promise<PracticeCatalog> {
  return {
    meditation: sortPracticesForCatalog(STATIC_MEDITATIONS),
    breath: sortPracticesForCatalog(createBreathPractices()),
    yoga: await loadYogaPractices(),
  };
}
