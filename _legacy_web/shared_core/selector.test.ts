import { describe, expect, it } from "vitest";

import {
  recentStackLimitForKind,
  selectPracticeCandidate,
  sortPracticeCandidatesForCatalog,
  type PracticeSelectorCandidate,
} from "./selector";

function candidate(input: Partial<PracticeSelectorCandidate> & Pick<PracticeSelectorCandidate, "id">): PracticeSelectorCandidate {
  return {
    slug: input.id,
    kind: "yoga",
    defaultDurationSec: 20 * 60,
    chakraIds: [6],
    ...input,
  };
}

describe("practice selector", () => {
  it("filters yoga by chakra and target duration tolerance before ranking by quality and recorded date", () => {
    const result = selectPracticeCandidate({
      candidates: [
        candidate({ id: "too-long", defaultDurationSec: 28 * 60, quality: 5, recordedAt: "2024-01-01" }),
        candidate({ id: "lower-quality", defaultDurationSec: 19 * 60, quality: 3, recordedAt: "2023-01-01" }),
        candidate({ id: "best-earlier", defaultDurationSec: 21 * 60, quality: 5, recordedAt: "2022-01-01" }),
        candidate({ id: "best-later", defaultDurationSec: 20 * 60, quality: 5, recordedAt: "2024-01-01" }),
        candidate({ id: "wrong-chakra", defaultDurationSec: 20 * 60, quality: 5, chakraIds: [4] }),
      ],
      preferredKind: "yoga",
      chakraId: 6,
      targetDurationSec: 20 * 60,
    });

    expect(result?.picked.id).toBe("best-earlier");
    expect(result?.stack.map((practice) => practice.id)).toEqual(["best-earlier", "best-later", "lower-quality"]);
  });

  it("excludes recent completed or offered practices while a fresh candidate exists", () => {
    const result = selectPracticeCandidate({
      candidates: [
        candidate({ id: "recent-best", quality: 5 }),
        candidate({ id: "fresh-second", quality: 4 }),
      ],
      preferredKind: "yoga",
      chakraId: 6,
      targetDurationSec: 20 * 60,
      recentIds: ["recent-best"],
    });

    expect(result?.picked.id).toBe("fresh-second");
    expect(result?.excludedRecentCount).toBe(1);
  });

  it("does not treat slug strings in recentIds as ids — caller must pass canonical catalog ids", () => {
    const result = selectPracticeCandidate({
      candidates: [
        { id: "uuid-a", slug: "slug-a", kind: "yoga", defaultDurationSec: 20 * 60, chakraIds: [6] },
        { id: "uuid-b", slug: "slug-b", kind: "yoga", defaultDurationSec: 20 * 60, chakraIds: [6] },
      ],
      preferredKind: "yoga",
      chakraId: 6,
      targetDurationSec: 20 * 60,
      recentIds: ["slug-a"],
    });
    expect(result?.picked.id).toBe("uuid-a");
    expect(result?.excludedRecentCount).toBe(0);
  });

  it("falls back to recent practices only when the whole matching stack is exhausted", () => {
    const result = selectPracticeCandidate({
      candidates: [candidate({ id: "recent-only", quality: 5 })],
      preferredKind: "yoga",
      chakraId: 6,
      targetDurationSec: 20 * 60,
      recentIds: ["recent-only"],
    });

    expect(result?.picked.id).toBe("recent-only");
    expect(result?.excludedRecentCount).toBe(1);
  });

  it("widens breath pool when day chakra matches only one practice so recent-stack can rotate", () => {
    const breath = (id: string, chakra: number, quality = 4): PracticeSelectorCandidate => ({
      id,
      slug: id,
      kind: "breath",
      defaultDurationSec: 10 * 60,
      quality,
      chakraIds: [chakra],
    });
    const result = selectPracticeCandidate({
      candidates: [
        breath("chandra-bhedana", 2, 5),
        breath("surya-bhedana", 3, 4),
        breath("coherent", 4, 4),
        breath("nadi-shodhana", 6, 4),
      ],
      preferredKind: "breath",
      chakraId: 2,
      recentIds: ["chandra-bhedana"],
    });

    expect(result?.picked.id).not.toBe("chandra-bhedana");
    expect(result?.excludedRecentCount).toBeGreaterThan(0);
    // Soft preference: among fresh candidates, day-chakra match would win if present;
    // here the only chakra-2 practice is excluded, so another breath is picked.
    expect(["surya-bhedana", "coherent", "nadi-shodhana"]).toContain(result?.picked.id);
  });

  it("uses nearest duration first when no yoga practice fits the 15 percent window", () => {
    const result = selectPracticeCandidate({
      candidates: [
        candidate({ id: "high-quality-far", defaultDurationSec: 40 * 60, quality: 5 }),
        candidate({ id: "lower-quality-near", defaultDurationSec: 26 * 60, quality: 3 }),
      ],
      preferredKind: "yoga",
      chakraId: 6,
      targetDurationSec: 20 * 60,
    });

    expect(result?.picked.id).toBe("lower-quality-near");
  });

  it("sorts catalog candidates by quality, recorded date, duration bucket and slug", () => {
    const sorted = sortPracticeCandidatesForCatalog([
      candidate({ id: "b", quality: 3, recordedAt: "2024-01-01", defaultDurationSec: 20 * 60 }),
      candidate({ id: "c", quality: 5, recordedAt: "2024-01-01", defaultDurationSec: 20 * 60 }),
      candidate({ id: "a", quality: 3, recordedAt: "2023-01-01", defaultDurationSec: 20 * 60 }),
      candidate({ id: "d", quality: 3, recordedAt: "2023-01-01", defaultDurationSec: 5 * 60 }),
    ]);

    expect(sorted.map((practice) => practice.id)).toEqual(["c", "d", "a", "b"]);
  });

  it("keeps recent stack limits aligned with product rules", () => {
    expect(recentStackLimitForKind("yoga", 200)).toBe(15);
    expect(recentStackLimitForKind("breath", 7)).toBe(7);
    expect(recentStackLimitForKind("meditation", 1)).toBe(1);
    expect(recentStackLimitForKind(null)).toBe(20);
  });
});
