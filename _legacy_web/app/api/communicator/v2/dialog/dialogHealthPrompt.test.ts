import { describe, expect, it } from "vitest";

import { formatHealthForPrompt, stripInventedNativeHealthClaims } from "./dialogHealthPrompt";

describe("formatHealthForPrompt", () => {
  it("omits zero step counts so the model cannot cite a bogus pedometer zero", () => {
    const text = formatHealthForPrompt({
      provider: "apple_health",
      providerStatus: "available",
      yoga: { totalMinutes: 5, practiceCount: 1, kinds: ["медитация"], averageDailyMinutes: 5, comparison: "similar" },
      activity: {
        steps: { value: 0, average: 4000, comparison: "lower" },
        activeCalories: { value: null, average: null, comparison: "unknown" },
        workoutMinutes: { value: 0, average: null, comparison: "unknown" },
      },
      sleep: { durationMinutes: { value: 0, average: null, comparison: "unknown" }, quality: "unknown" },
    });
    expect(text).toContain("yoga minutes");
    expect(text).not.toMatch(/steps:\s*\d/i);
    expect(text).not.toMatch(/sleep duration:\s*\d/i);
    expect(text).toMatch(/CRITICAL: no Apple\/Google Health numbers/i);
    expect(text).toMatch(/Do not name Apple Health or Health Connect/i);
    expect(text).not.toMatch(/source: Apple Health/i);
  });

  it("includes real positive steps and sleep duration from metric objects", () => {
    const text = formatHealthForPrompt({
      provider: "apple_health",
      providerStatus: "available",
      yoga: { totalMinutes: 0, practiceCount: 0, kinds: [], averageDailyMinutes: null, comparison: "unknown" },
      activity: {
        steps: { value: 1537, average: 4000, comparison: "lower" },
        activeCalories: { value: null, average: null, comparison: "unknown" },
        workoutMinutes: { value: null, average: null, comparison: "unknown" },
      },
      sleep: { durationMinutes: { value: 420, average: 450, comparison: "similar" }, quality: "good" },
    });
    expect(text).toContain("steps (Apple Health): 1537");
    expect(text).toContain("sleep duration (Apple Health): 7 hours");
    expect(text).toContain("sleep quality note (Apple Health)");
    expect(text).toContain("source: Apple Health");
    expect(text).toMatch(/attributing it in the same sentence to Apple Health/i);
    expect(text).toMatch(/Cite at least one concrete Health figure/i);
  });

  it("attributes Android native metrics to Health Connect, not Google Health", () => {
    const text = formatHealthForPrompt({
      provider: "google_health",
      providerStatus: "available",
      yoga: { totalMinutes: 0, practiceCount: 0, kinds: [], averageDailyMinutes: null, comparison: "unknown" },
      activity: {
        steps: { value: 4200, average: 5000, comparison: "lower" },
        activeCalories: { value: null, average: null, comparison: "unknown" },
        workoutMinutes: { value: null, average: null, comparison: "unknown" },
      },
      sleep: { durationMinutes: { value: null, average: null, comparison: "unknown" }, quality: "unknown" },
    });
    expect(text).toContain("steps (Health Connect): 4200");
    expect(text).toContain("source: Health Connect");
    expect(text).toMatch(/attributing it in the same sentence to Health Connect/i);
    expect(text).not.toMatch(/Google Health/i);
    expect(text).not.toContain("Apple Health");
  });

  it("does not name Apple Health or Health Connect when only yoga is present", () => {
    const text = formatHealthForPrompt({
      provider: "apple_health",
      providerStatus: "available",
      yoga: { totalMinutes: 6, practiceCount: 2, kinds: ["медитация"], averageDailyMinutes: 5, comparison: "similar" },
      activity: {
        steps: { value: null, average: null, comparison: "unknown" },
        activeCalories: { value: null, average: null, comparison: "unknown" },
        workoutMinutes: { value: null, average: null, comparison: "unknown" },
      },
      sleep: { durationMinutes: { value: null, average: null, comparison: "unknown" }, quality: "unknown" },
    });
    expect(text).toContain("yoga minutes");
    expect(text).toMatch(/Do not name Apple Health or Health Connect/i);
    expect(text).not.toMatch(/steps \(Apple Health\)/i);
    expect(text).not.toMatch(/source: Apple Health/i);
    expect(text).not.toMatch(/Cite at least one concrete Health figure/i);
  });

  it("labels active energy as kcal so the model does not say plain calories", () => {
    const text = formatHealthForPrompt({
      provider: "apple_health",
      providerStatus: "available",
      yoga: { totalMinutes: 0, practiceCount: 0, kinds: [], averageDailyMinutes: null, comparison: "unknown" },
      activity: {
        steps: { value: null, average: null, comparison: "unknown" },
        activeCalories: { value: 75, average: 98, comparison: "lower" },
        workoutMinutes: { value: null, average: null, comparison: "unknown" },
      },
      sleep: { durationMinutes: { value: null, average: null, comparison: "unknown" }, quality: "unknown" },
    });
    expect(text).toContain("active energy kcal (Apple Health): 75");
    expect(text).toMatch(/kilocalories\/kcal/i);
    expect(text).not.toMatch(/active calories:/i);
  });

  it("forbids vague health mentions when provider is available but numbers are missing", () => {
    const text = formatHealthForPrompt({
      provider: "apple_health",
      providerStatus: "available",
      yoga: { totalMinutes: 0, practiceCount: 0, kinds: [], averageDailyMinutes: null, comparison: "unknown" },
      activity: {
        steps: { value: null, average: null, comparison: "unknown" },
        activeCalories: { value: null, average: null, comparison: "unknown" },
        workoutMinutes: { value: null, average: null, comparison: "unknown" },
      },
      sleep: { durationMinutes: { value: null, average: null, comparison: "unknown" }, quality: "unknown" },
    });
    expect(text).toMatch(/do NOT invent/i);
    expect(text).toMatch(/do NOT mention steps/i);
  });

  it("forbids inventing steps even when yoga data is present", () => {
    const text = formatHealthForPrompt({
      provider: "apple_health",
      providerStatus: "available",
      yoga: { totalMinutes: 6, practiceCount: 2, kinds: ["медитация"], averageDailyMinutes: 5, comparison: "similar" },
      activity: {
        steps: { value: null, average: null, comparison: "unknown" },
        activeCalories: { value: null, average: null, comparison: "unknown" },
        workoutMinutes: { value: null, average: null, comparison: "unknown" },
      },
      sleep: { durationMinutes: { value: null, average: null, comparison: "unknown" }, quality: "unknown" },
    });
    expect(text).toContain("yoga minutes");
    expect(text).toMatch(/CRITICAL: no Apple\/Google Health numbers/i);
    expect(text).not.toMatch(/Cite at least one concrete Health figure/i);
  });
});

describe("stripInventedNativeHealthClaims", () => {
  it("removes hallucinated step sentences when native metrics were missing", () => {
    const text =
      "День был тёплым. По шагам вышло около 8200 — в самый раз. Сохраните это чувство.";
    const cleaned = stripInventedNativeHealthClaims(text, false);
    expect(cleaned).not.toMatch(/8200/);
    expect(cleaned).not.toMatch(/шаг/i);
    expect(cleaned).toMatch(/тёплым/i);
    expect(cleaned).toMatch(/Сохраните/i);
  });

  it("keeps real step citations when native metrics were present", () => {
    const text = "По шагам вышло около 2665 — спокойный день.";
    expect(stripInventedNativeHealthClaims(text, true)).toContain("2665");
  });

  it("drops a standalone Apple Health or Health Connect sentence when native metrics were missing", () => {
    const apple = stripInventedNativeHealthClaims(
      "День был тёплым. Согласно Apple Health, нагрузка была спокойной. Сохраните это чувство.",
      false,
    );
    expect(apple).not.toMatch(/Apple Health/i);
    expect(apple).toMatch(/тёплым/i);
    expect(apple).toMatch(/Сохраните/i);

    const android = stripInventedNativeHealthClaims(
      "Health Connect shows a quiet day. Keep that softness.",
      false,
    );
    expect(android).not.toMatch(/Health Connect/i);
    expect(android).toMatch(/Keep that softness/i);
  });

  it("keeps Apple Health attribution when native metrics were present", () => {
    const text = "Согласно Apple Health, вы прошли 2665 шагов.";
    expect(stripInventedNativeHealthClaims(text, true)).toContain("Apple Health");
    expect(stripInventedNativeHealthClaims(text, true)).toContain("2665");
  });
});
