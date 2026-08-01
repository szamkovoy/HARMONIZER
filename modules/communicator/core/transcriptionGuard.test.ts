import { describe, expect, it } from "vitest";

import { isSpuriousTranscription } from "./transcriptionGuard";

describe("isSpuriousTranscription", () => {
  it("rejects empty, punctuation-only, and ultra-short", () => {
    expect(isSpuriousTranscription("")).toBe(true);
    expect(isSpuriousTranscription("   ")).toBe(true);
    expect(isSpuriousTranscription("...")).toBe(true);
    expect(isSpuriousTranscription("ок")).toBe(true);
  });

  it("rejects common silence hallucinations", () => {
    expect(isSpuriousTranscription("Thank you.")).toBe(true);
    expect(isSpuriousTranscription("Thanks for watching!")).toBe(true);
    expect(isSpuriousTranscription("Хм")).toBe(true);
  });

  it("keeps real spoken answers (including short non-occurrence)", () => {
    expect(isSpuriousTranscription("Нет")).toBe(false);
    expect(isSpuriousTranscription("Было спокойно и немного устал")).toBe(false);
    expect(isSpuriousTranscription("Книгу не почитал, не хватило времени")).toBe(false);
  });
});

