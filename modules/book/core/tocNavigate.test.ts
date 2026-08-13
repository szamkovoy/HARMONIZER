import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tocHrefCandidates } from "./tocNavigate";

describe("tocHrefCandidates", () => {
  it("never emits bare #fragment (would resolve in current spine)", () => {
    const list = tocHrefCandidates("text/ch004.xhtml#часть-iii-яма");
    assert.ok(list.some((h) => h.includes("ch004") && h.includes("#")));
    assert.ok(!list.some((h) => h.startsWith("#")));
  });

  it("keeps file-only fallback after fragment variants", () => {
    const list = tocHrefCandidates("text/ch004.xhtml#часть-iii-яма");
    const fileOnly = list.filter((h) => !h.includes("#"));
    assert.ok(fileOnly.some((h) => h.includes("ch004")));
    const firstHash = list.findIndex((h) => h.includes("#"));
    const firstFile = list.findIndex((h) => !h.includes("#"));
    assert.ok(firstHash >= 0 && firstFile > firstHash);
  });
});
