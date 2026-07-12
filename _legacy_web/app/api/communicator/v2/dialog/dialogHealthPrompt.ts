function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatMetricForPrompt(label: string, value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const metric = value as { value?: unknown; average?: unknown; comparison?: unknown };
  const current = numberOrNull(metric.value);
  // 0 (or negative) means missing/broken provider data for summary — omit entirely,
  // same as null: never ask the model to cite a bogus pedometer/sleep zero.
  if (current == null || current <= 0) return null;
  const average = numberOrNull(metric.average);
  const comparison = typeof metric.comparison === "string" ? metric.comparison : "unknown";
  const averagePart = average != null && average > 0 ? `, average: ${Math.round(average)}` : "";
  const comparisonPart = comparison !== "unknown" ? `, comparison: ${comparison}` : "";
  return `${label}: ${Math.round(current)}${averagePart}${comparisonPart}`;
}

function formatDurationMinutesForPrompt(totalMinutes: number): string {
  const roundedMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (hours <= 0) return `${roundedMinutes} minutes`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} min`;
}

function sleepQualityLabelForPrompt(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  const labels: Record<string, string> = {
    short: "сон был короче обычного",
    long: "сон был длиннее обычного",
    normal: "сон был обычной длительности",
    average: "сон был обычной длительности",
    good: "качество сна выглядело хорошим",
    fair: "качество сна выглядело средним",
    poor: "качество сна выглядело низким",
    restless: "сон был беспокойным",
    interrupted: "сон прерывался",
    unknown: "",
  };
  const label = labels[normalized] ?? normalized.replace(/[_-]+/g, " ");
  return label.trim() || null;
}

function sleepDurationMinutes(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "object") {
    return numberOrNull((value as { value?: unknown }).value);
  }
  return numberOrNull(value);
}

/**
 * Compact Health block for the summarizing FINAL prompt.
 * Positive metrics only — zeros are treated as missing/broken provider data.
 */
export function formatHealthForPrompt(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const ctx = value as {
    providerStatus?: unknown;
    provider?: unknown;
    yoga?: { totalMinutes?: unknown; practiceCount?: unknown; averageDailyMinutes?: unknown; comparison?: unknown; kinds?: unknown };
    activity?: { steps?: unknown; activeCalories?: unknown; workoutMinutes?: unknown };
    sleep?: { durationMinutes?: unknown; quality?: unknown };
  };
  const lines: string[] = [];
  const provider = typeof ctx.provider === "string" ? ctx.provider : "unknown";
  const yogaMinutes = numberOrNull(ctx.yoga?.totalMinutes);
  const yogaPracticeCount = numberOrNull(ctx.yoga?.practiceCount);
  const yogaAverage = numberOrNull(ctx.yoga?.averageDailyMinutes);
  const yogaComparison = typeof ctx.yoga?.comparison === "string" ? ctx.yoga.comparison : "unknown";
  const yogaKinds = Array.isArray(ctx.yoga?.kinds)
    ? ctx.yoga.kinds.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];

  if (yogaPracticeCount != null && yogaPracticeCount > 0) {
    const minutesPart = yogaMinutes != null && yogaMinutes > 0 ? `${Math.round(yogaMinutes)}` : "0";
    const averagePart = yogaAverage != null ? `, average daily minutes: ${Math.round(yogaAverage)}` : "";
    const comparisonPart = yogaComparison !== "unknown" ? `, comparison: ${yogaComparison}` : "";
    const kindsPart = yogaKinds.length ? `, kinds: ${yogaKinds.join("/")}` : "";
    lines.push(
      `yoga minutes: ${minutesPart}, practices: ${Math.round(yogaPracticeCount)}${averagePart}${comparisonPart}${kindsPart}`,
    );
  } else if (yogaMinutes != null && yogaMinutes > 0) {
    const averagePart = yogaAverage != null ? `, average daily minutes: ${Math.round(yogaAverage)}` : "";
    const comparisonPart = yogaComparison !== "unknown" ? `, comparison: ${yogaComparison}` : "";
    const kindsPart = yogaKinds.length ? `, kinds: ${yogaKinds.join("/")}` : "";
    lines.push(`yoga minutes: ${Math.round(yogaMinutes)}${averagePart}${comparisonPart}${kindsPart}`);
  }

  const stepsLine = formatMetricForPrompt("steps", ctx.activity?.steps);
  // Apple HealthKit and Google Health Connect both expose active energy in
  // kilocalories (we request unit "kcal" / read inKilocalories). Label must say
  // kcal so the model does not call everyday food-"calories" (1 kcal = 1000 cal).
  const caloriesLine = formatMetricForPrompt("active energy kcal", ctx.activity?.activeCalories);
  const workoutLine = formatMetricForPrompt("workout minutes", ctx.activity?.workoutMinutes);
  const sleepMinutes = sleepDurationMinutes(ctx.sleep?.durationMinutes);
  const sleepLine = sleepMinutes != null && sleepMinutes > 0
    ? `sleep duration: ${formatDurationMinutesForPrompt(sleepMinutes)}`
    : null;
  if (stepsLine) lines.push(stepsLine);
  if (caloriesLine) lines.push(caloriesLine);
  if (workoutLine) lines.push(workoutLine);
  if (sleepLine) lines.push(sleepLine);
  if (sleepLine && typeof ctx.sleep?.quality === "string" && ctx.sleep.quality !== "unknown") {
    const sleepQuality = sleepQualityLabelForPrompt(ctx.sleep.quality);
    if (sleepQuality) {
      lines.push(`sleep quality note: ${sleepQuality}; do not quote raw provider codes.`);
    }
  }
  const hasNativeHealthMetric = Boolean(stepsLine || caloriesLine || workoutLine || sleepLine);
  const noInventNative =
    "CRITICAL: no Apple/Google Health numbers were shared for steps/sleep/active-energy/workouts — do NOT invent any of those figures and do NOT mention steps, sleep duration, kilocalories/kcal, or workouts at all (not even vaguely). Yoga/app practices above are allowed.";

  if (!lines.length) {
    return ctx.providerStatus === "available"
      ? `provider: ${provider}; ${noInventNative}`
      : "Apple/Google Health is unavailable; do not mention steps, sleep, kilocalories/kcal, workouts, or workload at all — not even vaguely.";
  }
  if (hasNativeHealthMetric) {
    lines.push(
      "Cite at least one concrete Health figure from the metrics above in the FINAL (exact numeric value from this context); pair any qualitative judgment with that number. Never invent a different step/sleep/kcal number than the one listed. For active energy, say kilocalories/kcal (RU: килокалории/ккал) — never plain «calories/калории».",
    );
  } else {
    // Yoga-only (or other non-native lines): still forbid inventing pedometer/sleep figures.
    lines.push(noInventNative);
  }
  return [`provider: ${provider}`, ...lines].join(", ");
}

/**
 * When native Health metrics were missing, strip invented step/sleep/calorie
 * sentences the model sometimes copies from prompt examples.
 */
export function stripInventedNativeHealthClaims(text: string, hasNativeMetric: boolean): string {
  if (hasNativeMetric || !text.trim()) return text;
  const sentenceSplit = /(?<=[.!?…])\s+|\n+/u;
  const parts = text.split(sentenceSplit);
  const kept = parts.filter((part) => {
    const trimmed = part.trim();
    if (!trimmed) return false;
    const mentionsNative =
      /(?:шаг(?:ов|а|и|ами)?|steps?|сон(?:а|у|ом)?|sleep|калор(?:ий|ии|иями)?|calories?|workout|трениров)/i.test(trimmed);
    const hasDigit = /\d/.test(trimmed);
    // Drop only claims that invent a number for native Health topics.
    if (mentionsNative && hasDigit) return false;
    // Also drop vague native-health impressions without numbers.
    if (mentionsNative && /(?:по шагам|по сну|по калориям|по нагрузке|light on steps|quiet on steps)/i.test(trimmed)) {
      return false;
    }
    return true;
  });
  return kept.join(" ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/  +/g, " ").trim();
}

/** Compact diagnostics for logs / dialog export — why FINAL may omit Apple/Google numbers. */
export function describeHealthContextForDebug(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return { present: false, promptChars: 0 };
  }
  const ctx = value as {
    localDate?: unknown;
    providerStatus?: unknown;
    provider?: unknown;
    yoga?: { totalMinutes?: unknown; practiceCount?: unknown };
    activity?: { steps?: { value?: unknown }; activeCalories?: { value?: unknown }; workoutMinutes?: { value?: unknown } };
    sleep?: { durationMinutes?: { value?: unknown } | unknown };
    collectionTrace?: unknown;
  };
  const prompt = formatHealthForPrompt(value);
  const steps = numberOrNull(ctx.activity?.steps?.value);
  const calories = numberOrNull(ctx.activity?.activeCalories?.value);
  const workout = numberOrNull(ctx.activity?.workoutMinutes?.value);
  const sleep = sleepDurationMinutes(ctx.sleep?.durationMinutes);
  return {
    present: true,
    localDate: typeof ctx.localDate === "string" ? ctx.localDate : null,
    provider: typeof ctx.provider === "string" ? ctx.provider : null,
    providerStatus: typeof ctx.providerStatus === "string" ? ctx.providerStatus : null,
    steps: steps != null && steps > 0 ? Math.round(steps) : null,
    activeCalories: calories != null && calories > 0 ? Math.round(calories) : null,
    workoutMinutes: workout != null && workout > 0 ? Math.round(workout) : null,
    sleepMinutes: sleep != null && sleep > 0 ? Math.round(sleep) : null,
    yogaMinutes: numberOrNull(ctx.yoga?.totalMinutes),
    yogaPracticeCount: numberOrNull(ctx.yoga?.practiceCount),
    promptChars: prompt.length,
    hasNativeMetric: Boolean(
      (steps != null && steps > 0)
      || (calories != null && calories > 0)
      || (workout != null && workout > 0)
      || (sleep != null && sleep > 0),
    ),
    collectionTrace: ctx.collectionTrace ?? null,
  };
}
