import { describe, expect, it } from "vitest";

import { storyRowFromPayload } from "./storyPayload";

describe("storyRowFromPayload", () => {
  it("по умолчанию ставит expires_at = publish_at + 24h", () => {
    const row = storyRowFromPayload({
      kind: "image",
      image_url: "https://x/storage/v1/object/public/story-media/a.jpg",
      publish_at: "2026-07-08T10:00:00.000Z",
    });
    expect(row.expires_at).toBe("2026-07-09T10:00:00.000Z");
    expect(row.kind).toBe("image");
    expect(row.video_url).toBeNull();
  });

  it("видео кладёт в video_url и уважает явный expires_at", () => {
    const row = storyRowFromPayload({
      kind: "video",
      video_url: "https://x/v.mp4",
      cover_url: "https://x/c.jpg",
      caption: "  Привет  ",
      publish_at: "2026-07-08T10:00:00.000Z",
      expires_at: "2026-07-10T10:00:00.000Z",
      is_evergreen: true,
    });
    expect(row.video_url).toBe("https://x/v.mp4");
    expect(row.image_url).toBeNull();
    expect(row.cover_url).toBe("https://x/c.jpg");
    expect(row.caption).toEqual({ text: "Привет" });
    expect(row.expires_at).toBe("2026-07-10T10:00:00.000Z");
    expect(row.is_evergreen).toBe(true);
  });

  it("отклоняет сторис без медиа как 400", () => {
    try {
      storyRowFromPayload({ kind: "image" });
      expect.unreachable("должен был бросить Response");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(400);
    }
  });
});
