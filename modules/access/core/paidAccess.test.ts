import { describe, expect, it } from "vitest";

import { accessModeFromRow, baseTierFromRow, hasEffectivePremium, paidTierFromRow } from "./paidAccess";

const NOW = new Date("2026-07-08T12:00:00Z");
const FUTURE = "2026-08-01T00:00:00Z";
const PAST = "2026-07-01T00:00:00Z";

describe("paidAccess", () => {
  it.each([
    // [membership_tier, membership_expires_at, trial_expires_at, paidTier, mode]
    ["free", null, null, null, "free"],
    ["free", null, FUTURE, null, "trial"],
    ["free", null, PAST, null, "free"],
    ["premium", null, null, "oracle", "premium"], // legacy-значение до нормализации
    ["oracle", null, null, "oracle", "premium"],
    ["practitioner", null, null, "practitioner", "premium"],
    ["master", null, null, "master", "premium"],
    ["master", FUTURE, null, "master", "premium"], // грант ещё действует
    ["master", PAST, null, null, "free"], // грант истёк → free
    ["master", PAST, FUTURE, null, "trial"], // истёкший грант, но активный trial
    ["MASTER ", null, null, "master", "premium"], // нормализация регистра/пробелов
    ["unknown", null, null, null, "free"],
    [null, null, null, null, "free"],
  ] as const)(
    "tier=%s expires=%s trial=%s → paid=%s mode=%s",
    (tier, expires, trial, expectedPaid, expectedMode) => {
      const row = {
        membership_tier: tier,
        membership_expires_at: expires,
        trial_expires_at: trial,
      };
      expect(paidTierFromRow(row, NOW)).toBe(expectedPaid);
      expect(accessModeFromRow(row, NOW)).toBe(expectedMode);
      expect(baseTierFromRow(row, NOW)).toBe(expectedPaid ?? "free");
      expect(hasEffectivePremium(row, NOW)).toBe(expectedMode !== "free");
    },
  );

  it("null/undefined row → free без ошибок", () => {
    expect(paidTierFromRow(null, NOW)).toBeNull();
    expect(accessModeFromRow(undefined, NOW)).toBe("free");
    expect(hasEffectivePremium(null, NOW)).toBe(false);
  });
});
