/**
 * ЮKassa smart upgrade: unused Mentor (oracle) days → extra Master days.
 * bonusDays = floor(remainingDays * oracleAmount / masterAmount)
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeMasterBonusDays(params: {
  periodEndIso: string | null | undefined;
  oracleAmount: number | null | undefined;
  masterAmount: number | null | undefined;
  now?: Date;
}): number {
  const periodEnd = params.periodEndIso ? Date.parse(params.periodEndIso) : NaN;
  if (!Number.isFinite(periodEnd)) return 0;
  const now = (params.now ?? new Date()).getTime();
  const remainingDays = (periodEnd - now) / DAY_MS;
  if (remainingDays <= 0) return 0;

  const oracle = Number(params.oracleAmount);
  const master = Number(params.masterAmount);
  if (!(oracle > 0) || !(master > 0)) return 0;

  return Math.max(0, Math.floor(remainingDays * (oracle / master)));
}

export function periodEndWithBonusDays(from: Date, bonusDays: number): Date {
  const base = from.getTime() + 30 * DAY_MS;
  const bonus = Math.max(0, Math.floor(bonusDays)) * DAY_MS;
  return new Date(base + bonus);
}
