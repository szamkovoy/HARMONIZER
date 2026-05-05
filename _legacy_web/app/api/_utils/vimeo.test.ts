import { describe, expect, it } from "vitest";

import { pickBestVimeoThumbnail } from "@legacy/app/api/_utils/vimeo";

describe("pickBestVimeoThumbnail", () => {
  it("prefers the smallest thumbnail that still meets the target width", () => {
    expect(
      pickBestVimeoThumbnail(
        [
          { width: 100, height: 75, link: "small" },
          { width: 200, height: 150, link: "medium" },
          { width: 295, height: 166, link: "large" },
        ],
        180,
      ),
    ).toEqual({
      url: "medium",
      width: 200,
      height: 150,
    });
  });

  it("falls back to the largest available thumbnail when all are smaller than target", () => {
    expect(
      pickBestVimeoThumbnail(
        [
          { width: 100, height: 75, link: "small" },
          { width: 200, height: 150, link: "medium" },
        ],
        260,
      ),
    ).toEqual({
      url: "medium",
      width: 200,
      height: 150,
    });
  });
});
