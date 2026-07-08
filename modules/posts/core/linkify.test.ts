import { describe, expect, it } from "vitest";

import { splitBodyIntoSegments } from "@/modules/posts/core/linkify";

describe("splitBodyIntoSegments", () => {
  it("returns a single text segment when there are no links", () => {
    expect(splitBodyIntoSegments("Просто текст\nв две строки")).toEqual([
      { type: "text", value: "Просто текст\nв две строки" },
    ]);
  });

  it("extracts URLs and keeps surrounding text", () => {
    expect(splitBodyIntoSegments("Смотрите https://example.com/a?b=1 и пишите")).toEqual([
      { type: "text", value: "Смотрите " },
      { type: "link", value: "https://example.com/a?b=1" },
      { type: "text", value: " и пишите" },
    ]);
  });

  it("does not swallow trailing punctuation", () => {
    expect(splitBodyIntoSegments("Запись: https://youtu.be/xyz.")).toEqual([
      { type: "text", value: "Запись: " },
      { type: "link", value: "https://youtu.be/xyz" },
      { type: "text", value: "." },
    ]);
  });

  it("handles multiple links", () => {
    const segments = splitBodyIntoSegments("http://a.io и https://b.io");
    expect(segments.filter((s) => s.type === "link").map((s) => s.value)).toEqual([
      "http://a.io",
      "https://b.io",
    ]);
  });
});
