import { describe, expect, it } from "vitest";

import { resolveTurnHistory } from "./dialogHelpers";

describe("resolveTurnHistory", () => {
  it("preserves client-side practice meta in turnHistory", () => {
    const resolved = resolveTurnHistory(
      [
        {
          role: "assistant",
          content: "Вот практика",
          meta: {
            practicePicked: {
              id: "practice-1",
            },
          },
        },
      ],
      [],
    );

    expect(resolved[0]?.meta).toEqual({
      practicePicked: {
        id: "practice-1",
      },
    });
  });
});
