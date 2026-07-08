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
  // vimeoToken() читает три имени env; чистим и восстанавливаем все,
  // иначе токен из .env.local делает тест сетевым и нестабильным.
  const TOKEN_ENV_NAMES = ["VIMEO_ACCESS_TOKEN", "vimeo_token", "VIMEO_TOKEN"] as const;
  const originalTokens = TOKEN_ENV_NAMES.map((name) => [name, process.env[name]] as const);

  afterEach(() => {
    for (const [name, value] of originalTokens) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.restoreAllMocks();
  });

  it("returns the practice unchanged when Vimeo metadata is unavailable", async () => {
    for (const name of TOKEN_ENV_NAMES) delete process.env[name];
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

    await expect(
      attachThumbnailToPracticeRecommendation(
        practice as unknown as Parameters<typeof attachThumbnailToPracticeRecommendation>[0],
        295,
      ),
    ).resolves.toEqual(practice);
    expect(warnSpy).toHaveBeenCalledWith(
      "[vimeo] attach thumbnail skipped",
      "123456",
      expect.stringContaining("Missing Vimeo token"),
    );
  });
});
