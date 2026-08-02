/**
 * Breath tempo presets and helpers.
 *
 * Linear / square practices use a single beat count per phase.
 * Triangle practices use fixed inhale/hold/exhale (or inhale/exhale/hold) triples.
 */
import type { BreathPracticeId } from "@/modules/breath/i18n/coherence";
import type { BreathPhaseShape } from "@/modules/breath/core/breath-phase-planner";
import type { BreathPracticeDescriptor } from "@/modules/breath/core/practices";

/** Card ComboBox options for non-triangle practices. */
export const LINEAR_CARD_TEMPO_BEATS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** Overlay may go above the card list; soft ceiling only. */
export const LINEAR_OVERLAY_MAX_BEATS = 60;
export const LINEAR_OVERLAY_MIN_BEATS = 1;

/** Inhale : exhale : hold (Bahir Kumbhaka). */
export const TRIANGLE_UP_TEMPO_PRESETS: ReadonlyArray<readonly [number, number, number]> = [
  [3, 3, 3],
  [4, 4, 4],
  [5, 5, 5],
  [6, 6, 6],
  [3, 3, 6],
  [3, 6, 6],
  [3, 6, 12],
  [4, 4, 8],
  [4, 8, 8],
  [4, 8, 16],
  [5, 5, 10],
  [5, 10, 10],
  [5, 10, 20],
];

/** Inhale : hold : exhale (Antar Kumbhaka). */
export const TRIANGLE_DOWN_TEMPO_PRESETS: ReadonlyArray<readonly [number, number, number]> = [
  [3, 3, 3],
  [4, 4, 4],
  [5, 5, 5],
  [6, 6, 6],
  [3, 6, 3],
  [3, 6, 6],
  [3, 12, 6],
  [4, 8, 4],
  [4, 8, 8],
  [4, 16, 8],
  [5, 10, 5],
  [5, 10, 10],
  [5, 20, 10],
];

export const TEMPO_HEADER_OPTION_VALUE = "__tempo_header__";

export type ParsedBreathTempo =
  | { mode: "single"; beats: number }
  | { mode: "triple"; beats: readonly [number, number, number] };

export function isTriangleBreathPracticeId(id: BreathPracticeId): boolean {
  return id === "triangle-up" || id === "triangle-down";
}

export function triangleTempoPresets(
  id: "triangle-up" | "triangle-down",
): ReadonlyArray<readonly [number, number, number]> {
  return id === "triangle-up" ? TRIANGLE_UP_TEMPO_PRESETS : TRIANGLE_DOWN_TEMPO_PRESETS;
}

export function defaultTempoKey(id: BreathPracticeId): string {
  if (id === "square") return "4";
  if (id === "triangle-up" || id === "triangle-down") return "4:4:4";
  return "6";
}

export function formatTempoKey(beats: number): string;
export function formatTempoKey(a: number, b: number, c: number): string;
export function formatTempoKey(a: number, b?: number, c?: number): string {
  if (b == null || c == null) return String(a);
  return `${a}:${b}:${c}`;
}

export function formatTempoLabel(tempoKey: string): string {
  const parsed = parseTempoKey(tempoKey);
  if (!parsed) return tempoKey;
  if (parsed.mode === "single") return String(parsed.beats);
  const [a, b, c] = parsed.beats;
  return `${a} : ${b} : ${c}`;
}

export function parseTempoKey(raw: string | null | undefined): ParsedBreathTempo | null {
  if (raw == null || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === TEMPO_HEADER_OPTION_VALUE) return null;
  if (/^\d+$/.test(trimmed)) {
    const beats = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(beats) || beats < 1) return null;
    return { mode: "single", beats };
  }
  const parts = trimmed.split(":").map((part) => Number.parseInt(part.trim(), 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 1)) return null;
  return { mode: "triple", beats: [parts[0]!, parts[1]!, parts[2]!] };
}

export function tempoKeyFromTriple(beats: readonly [number, number, number]): string {
  return formatTempoKey(beats[0], beats[1], beats[2]);
}

/** Card list keys for a practice (no header). */
export function cardTempoOptionKeys(id: BreathPracticeId): string[] {
  if (id === "triangle-up") {
    return TRIANGLE_UP_TEMPO_PRESETS.map((t) => tempoKeyFromTriple(t));
  }
  if (id === "triangle-down") {
    return TRIANGLE_DOWN_TEMPO_PRESETS.map((t) => tempoKeyFromTriple(t));
  }
  return LINEAR_CARD_TEMPO_BEATS.map((n) => String(n));
}

/**
 * When persisting after a practice, map overlay values onto the card list
 * (e.g. 15 → 12, 1 → 2). Triangles must match a preset exactly.
 */
export function persistableTempoKey(id: BreathPracticeId, tempoKey: string): string {
  const parsed = parseTempoKey(tempoKey);
  if (!parsed) return defaultTempoKey(id);
  if (isTriangleBreathPracticeId(id)) {
    if (parsed.mode !== "triple") return defaultTempoKey(id);
    const key = tempoKeyFromTriple(parsed.beats);
    const allowed = cardTempoOptionKeys(id);
    return allowed.includes(key) ? key : defaultTempoKey(id);
  }
  if (parsed.mode !== "single") return defaultTempoKey(id);
  const clamped = Math.min(
    LINEAR_CARD_TEMPO_BEATS[LINEAR_CARD_TEMPO_BEATS.length - 1]!,
    Math.max(LINEAR_CARD_TEMPO_BEATS[0]!, parsed.beats),
  );
  return String(clamped);
}

/** Normalize launch/prefs/raw value to a usable tempo key for a practice. */
export function resolveTempoKey(id: BreathPracticeId, raw: string | null | undefined): string {
  const parsed = parseTempoKey(raw);
  if (!parsed) return defaultTempoKey(id);
  if (isTriangleBreathPracticeId(id)) {
    if (parsed.mode !== "triple") return defaultTempoKey(id);
    const key = tempoKeyFromTriple(parsed.beats);
    return cardTempoOptionKeys(id).includes(key) ? key : defaultTempoKey(id);
  }
  if (parsed.mode !== "single") return defaultTempoKey(id);
  const beats = Math.min(
    LINEAR_OVERLAY_MAX_BEATS,
    Math.max(LINEAR_OVERLAY_MIN_BEATS, parsed.beats),
  );
  return String(beats);
}

export function buildShapeForTempo(
  practice: BreathPracticeDescriptor,
  tempoKey: string,
): BreathPhaseShape {
  const key = resolveTempoKey(practice.id, tempoKey);
  const parsed = parseTempoKey(key)!;
  if (practice.id === "triangle-up" && parsed.mode === "triple") {
    const [inhale, exhale, hold] = parsed.beats;
    return {
      phases: [
        { kind: "inhale", beats: inhale, channel: "both" },
        { kind: "exhale", beats: exhale, channel: "both" },
        { kind: "hold", beats: hold, channel: "both" },
      ],
      baseIndex: 0,
    };
  }
  if (practice.id === "triangle-down" && parsed.mode === "triple") {
    const [inhale, hold, exhale] = parsed.beats;
    return {
      phases: [
        { kind: "inhale", beats: inhale, channel: "both" },
        { kind: "hold", beats: hold, channel: "both" },
        { kind: "exhale", beats: exhale, channel: "both" },
      ],
      baseIndex: 0,
    };
  }
  const beats = parsed.mode === "single" ? parsed.beats : practice.normalBaseBeats;
  return practice.buildShape(beats);
}

export function stepLinearTempoKey(tempoKey: string, delta: 1 | -1): string {
  const parsed = parseTempoKey(tempoKey);
  const current =
    parsed?.mode === "single" ? parsed.beats : Number.parseInt(defaultTempoKey("coherent"), 10);
  const next = Math.min(
    LINEAR_OVERLAY_MAX_BEATS,
    Math.max(LINEAR_OVERLAY_MIN_BEATS, current + delta),
  );
  return String(next);
}

export function stepTriangleTempoKey(
  id: "triangle-up" | "triangle-down",
  tempoKey: string,
  delta: 1 | -1,
): string | null {
  const presets = triangleTempoPresets(id);
  const keys = presets.map((t) => tempoKeyFromTriple(t));
  const resolved = resolveTempoKey(id, tempoKey);
  const index = keys.indexOf(resolved);
  if (index < 0) return null;
  const next = index + delta;
  if (next < 0 || next >= keys.length) return null;
  return keys[next]!;
}

export function canStepTriangleTempo(
  id: "triangle-up" | "triangle-down",
  tempoKey: string,
  delta: 1 | -1,
): boolean {
  return stepTriangleTempoKey(id, tempoKey, delta) != null;
}

export function isDefaultTempoKey(id: BreathPracticeId, tempoKey: string): boolean {
  return resolveTempoKey(id, tempoKey) === defaultTempoKey(id);
}
