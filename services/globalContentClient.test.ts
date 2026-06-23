import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireSupabaseMock } = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/services/supabase", () => ({
  requireSupabase: requireSupabaseMock,
}));

vi.mock("@/services/communicatorConfig", () => ({
  getAiGlobalContentUrl: () => "https://example.test/api/ai/global-content",
}));

vi.mock("@/modules/i18n/localeStore", () => ({
  getResponseLocale: () => "de",
}));

import { fetchGlobalContent } from "./globalContentClient";

function buildGlobalContentRow() {
  return {
    forecast_date_utc: "2026-06-23",
    slogan: "RU slogan",
    short_text: "RU short",
    long_explanation: "RU long",
    math_level: { markdown: "math", structured: {} },
    primary_planet: "Mars",
    primary_tone: "harmonic",
    top_petals: [
      {
        planet: "Mars",
        chakra_number: 3,
        chakra_label: "третья чакра",
        gravity: 1.23,
        tone: "harmonic",
      },
    ],
    planet_positions: {},
    llm_model: "gemini-test",
    text_i18n: {
      de: {
        slogan: "DE slogan",
        short_text: "DE short",
        long_explanation: "DE long",
      },
    },
  };
}

function createSupabaseMock(row: Record<string, unknown>) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "token" } },
        error: null,
      }),
    },
    from: vi.fn((_table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        order: vi.fn(() => query),
        limit: vi.fn(() => query),
        abortSignal: vi.fn(() => query),
        maybeSingle: vi.fn().mockResolvedValue({
          data: row,
          error: null,
        }),
      };
      return query;
    }),
  };
}

describe("fetchGlobalContent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("falls back to direct global_daily_content read after route timeout", async () => {
    requireSupabaseMock.mockReturnValue(createSupabaseMock(buildGlobalContentRow()));
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchGlobalContent({
      userLocation: { lat: 52.52, lng: 13.405, timezone: "Europe/Berlin" },
      responseLocale: "de",
    });

    await vi.advanceTimersByTimeAsync(25_000);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.forecast.slogan).toBe("DE slogan");
    expect(result.forecast.recommendationShortText).toBe("DE short");
    expect(result.forecast.recommendationLongText).toBe("DE long");
    expect(result.modelUsed).toBe("gemini-test");
  });
});
