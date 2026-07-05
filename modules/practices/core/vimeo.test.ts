import { describe, expect, it } from "vitest";

import {
  vimeoAudiotrackForLocale,
  vimeoEmbedHtml,
  vimeoEmbedUrl,
  VIMEO_DEFAULT_AUDIOTRACK,
  VIMEO_EMBED_BASE_URL,
} from "@/modules/practices/core/vimeo";

describe("vimeoEmbedUrl", () => {
  it("builds the canonical embed URL with the default Russian audiotrack", () => {
    expect(vimeoEmbedUrl("1111204587")).toBe(
      "https://player.vimeo.com/video/1111204587?audiotrack=ru",
    );
  });

  it("uses the provided audiotrack slug", () => {
    expect(vimeoEmbedUrl("1111204587", "en")).toBe(
      "https://player.vimeo.com/video/1111204587?audiotrack=en",
    );
  });

  it("trims whitespace and falls back to the default audiotrack when empty", () => {
    expect(vimeoEmbedUrl("  1111204587  ", "  ")).toBe(
      "https://player.vimeo.com/video/1111204587?audiotrack=ru",
    );
  });

  it("encodes unsafe characters in the id", () => {
    expect(vimeoEmbedUrl("1 2/3")).toBe("https://player.vimeo.com/video/1%202%2F3?audiotrack=ru");
  });

  it("exposes the default audiotrack constant", () => {
    expect(VIMEO_DEFAULT_AUDIOTRACK).toBe("ru");
  });
});

describe("vimeoEmbedHtml", () => {
  it("builds a full HTML document that mounts the Vimeo iframe", () => {
    const html = vimeoEmbedHtml("1111204587");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain(
      'src="https://player.vimeo.com/video/1111204587?audiotrack=ru"',
    );
    expect(html).toContain('allow="autoplay; fullscreen; encrypted-media"');
    expect(html).toContain('allowfullscreen');
  });

  it("honours a custom audiotrack slug inside the iframe src", () => {
    expect(vimeoEmbedHtml("1111204587", "en")).toContain(
      'src="https://player.vimeo.com/video/1111204587?audiotrack=en"',
    );
  });

  it("exposes the zamkovoi.yoga base URL for the WebView baseUrl", () => {
    expect(VIMEO_EMBED_BASE_URL).toBe("https://zamkovoi.yoga/");
  });
});

describe("vimeoAudiotrackForLocale", () => {
  it("maps the Russian locale to the Russian audio track", () => {
    expect(vimeoAudiotrackForLocale("ru")).toBe("ru");
  });

  it("maps every non-Russian content locale to the English audio track", () => {
    for (const locale of ["en", "de", "fr", "it", "es", "pt", "nl"] as const) {
      expect(vimeoAudiotrackForLocale(locale)).toBe("en");
    }
  });
});
