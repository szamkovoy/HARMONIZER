import { afterEach, describe, expect, it, vi } from "vitest";

import { attachThumbnailToPracticeRecommendation, pickBestVimeoThumbnail } from "@legacy/app/api/_utils/vimeo";

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

describe("attachThumbnailToPracticeRecommendation", () => {
  const originalToken = process.env.VIMEO_ACCESS_TOKEN;

  afterEach(() => {
    process.env.VIMEO_ACCESS_TOKEN = originalToken;
    vi.restoreAllMocks();
  });

  it("returns the practice unchanged when Vimeo metadata is unavailable", async () => {
    delete process.env.VIMEO_ACCESS_TOKEN;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const practice = {
      id: "asana-1",
      kind: "yoga",
      reason: "test",
      video: {
        provider: "vimeo",
        externalId: "123456",
      },
    };

    await expect(attachThumbnailToPracticeRecommendation(practice, 295)).resolves.toEqual(practice);
    expect(warnSpy).toHaveBeenCalledWith(
      "[vimeo] attach thumbnail skipped",
      "123456",
      expect.stringContaining("Missing Vimeo token"),
    );
  });
});
