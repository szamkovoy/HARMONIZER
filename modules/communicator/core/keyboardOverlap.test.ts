import { describe, expect, it } from "vitest";

import {
  composerKeyboardPad,
  resolveKeyboardTop,
  transcriptInputMaxHeight,
  transcriptReviewViewport,
} from "./keyboardOverlap";

describe("composerKeyboardPad", () => {
  it("pads by the overlap when the window still extends under the keyboard", () => {
    expect(composerKeyboardPad(800, 480)).toBe(320);
  });

  it("stays at 0 when adjustResize already ended the window on the keyboard", () => {
    expect(composerKeyboardPad(480, 480)).toBe(0);
    expect(composerKeyboardPad(470, 480)).toBe(0);
  });

  it("ignores a few px of nav-bar rounding", () => {
    expect(composerKeyboardPad(492, 480)).toBe(0);
    expect(composerKeyboardPad(493, 480)).toBe(13);
  });

  it("does nothing for missing coordinates", () => {
    expect(composerKeyboardPad(0, 400)).toBe(0);
    expect(composerKeyboardPad(800, 0)).toBe(0);
    expect(composerKeyboardPad(Number.NaN, 400)).toBe(0);
  });
});

describe("resolveKeyboardTop", () => {
  it("prefers a reported screenY", () => {
    expect(resolveKeyboardTop(480, 320, 800, 800)).toBe(480);
  });

  it("falls back to height when the window is still full and screenY is missing", () => {
    expect(resolveKeyboardTop(0, 320, 800, 800)).toBe(480);
  });

  it("does not invent a top when the window already shrank", () => {
    expect(resolveKeyboardTop(0, 320, 480, 800)).toBe(0);
  });
});

describe("transcriptReviewViewport", () => {
  it("is 0 while the keyboard is closed", () => {
    expect(transcriptReviewViewport(700, 0, 26)).toBe(0);
  });

  it("is the composer height left above the keyboard and footer chrome", () => {
    expect(transcriptReviewViewport(700, 320, 26)).toBe(354);
  });
});

describe("transcriptInputMaxHeight", () => {
  it("keeps the resting box when the keyboard is closed or there is room", () => {
    expect(transcriptInputMaxHeight(0, 1)).toBe(140);
    expect(transcriptInputMaxHeight(400, 1)).toBe(140);
    expect(transcriptInputMaxHeight(400, 1.5)).toBe(140);
  });

  it("shrinks on a short viewport but keeps at least one line", () => {
    expect(transcriptInputMaxHeight(160, 1)).toBe(84);
    expect(transcriptInputMaxHeight(90, 1.4)).toBeLessThan(140);
    expect(transcriptInputMaxHeight(90, 1.4)).toBeGreaterThanOrEqual(Math.round(22 * 1.4 + 16));
  });
});
