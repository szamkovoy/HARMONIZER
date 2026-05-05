import { beforeEach, describe, expect, it, vi } from "vitest";

import { launchPractice } from "./launchPractice";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("expo-router", () => ({
  router: {
    push: mocks.push,
  },
}));

describe("launchPractice", () => {
  beforeEach(() => {
    mocks.push.mockClear();
  });

  it("launches assistant recommendations with launchSource appended", () => {
    expect(
      launchPractice(
        {
          route: "/asana-practice",
          params: {
            practiceId: "practice-1",
            durationMs: "1200000",
            chakra: "6",
          },
        },
        { launchSource: "assistant" },
      ),
    ).toBe(true);

    expect(mocks.push).toHaveBeenCalledWith({
      pathname: "/asana-practice",
      params: {
        practiceId: "practice-1",
        durationMs: "1200000",
        chakra: "6",
        launchSource: "assistant",
      },
    });
  });

  it("launches catalog meditation with duration, chakra and launchSource", () => {
    expect(
      launchPractice(
        {
          kind: "meditation",
          route: "/sacred-symbol-stream",
          practiceId: "sacred-symbol-stream",
          durationMs: 180_000,
          chakra: 1,
        },
        { launchSource: "catalog" },
      ),
    ).toBe(true);

    expect(mocks.push).toHaveBeenCalledWith({
      pathname: "/sacred-symbol-stream",
      params: {
        practiceId: "sacred-symbol-stream",
        durationMs: "180000",
        chakra: "1",
        launchSource: "catalog",
      },
    });
  });

  it("returns false when launch payload is absent", () => {
    expect(launchPractice(null)).toBe(false);
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
