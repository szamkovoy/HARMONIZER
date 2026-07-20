import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireSupabaseMock, getSupabaseAccessTokenMock } = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
  getSupabaseAccessTokenMock: vi.fn(async () => "token"),
}));

vi.mock("@/services/supabase", () => ({
  requireSupabase: requireSupabaseMock,
  getSupabaseAccessToken: getSupabaseAccessTokenMock,
}));

vi.mock("@/services/communicatorConfig", () => ({
  getAiGlobalContentUrl: () => "https://example.test/api/ai/global-content",
}));

vi.mock("@/modules/i18n/localeStore", () => ({
  getResponseLocale: () => "de",
}));

import { fetchGlobalContent } from "./globalContentClient";

function buildStructuredLong(localePrefix: string) {
  return [
    `§1. ${localePrefix} one`,
    "Paragraph.",
    `§2. ${localePrefix} two`,
    "Paragraph.",
    `§3. ${localePrefix} three`,
    "Paragraph.",
    `§4. ${localePrefix} four`,
    "Paragraph.",
    `§5. ${localePrefix} five`,
    "Paragraph.",
    `§6. ${localePrefix} six`,
    "Paragraph.",
  ].join("\n\n");
}

function buildGlobalContentRow() {
  return {
    forecast_date_utc: "2026-06-23",
    slogan: "RU slogan",
    short_text: "RU short",
    long_explanation: buildStructuredLong("RU"),
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
        long_explanation: buildStructuredLong("DE"),
      },
    },
  };
}

function createSupabaseMock(row: Record<string, unknown> | null) {
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
    getSupabaseAccessTokenMock.mockResolvedValue("token");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reads global_daily_content directly without calling the route when texts exist", async () => {
    requireSupabaseMock.mockReturnValue(createSupabaseMock(buildGlobalContentRow()));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGlobalContent({
      userLocation: { lat: 52.52, lng: 13.405, timezone: "Europe/Berlin" },
      responseLocale: "de",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSupabaseAccessTokenMock).not.toHaveBeenCalled();
    expect(result.forecast.slogan).toBe("DE slogan");
    expect(result.forecast.recommendationShortText).toBe("DE short");
    expect(result.forecast.recommendationLongText).toBe(buildStructuredLong("DE"));
    expect(result.modelUsed).toBe("gemini-test");
  });

  it("uses canonical RU from direct row when locale text_i18n is missing (no route wait)", async () => {
    const row = buildGlobalContentRow();
    delete (row as { text_i18n?: unknown }).text_i18n;
    requireSupabaseMock.mockReturnValue(createSupabaseMock(row));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGlobalContent({
      userLocation: { lat: 52.52, lng: 13.405, timezone: "Europe/Berlin" },
      responseLocale: "de",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.forecast.slogan).toBe("RU slogan");
    expect(result.forecast.recommendationShortText).toBe("RU short");
  });

  it("falls back to direct global_daily_content read after route timeout", async () => {
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

    // Fast-path direct miss (primary + latest empty) → route → timeout → direct hit.
    const row = buildGlobalContentRow();
    let maybeSingleCalls = 0;
    requireSupabaseMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token" } },
          error: null,
        }),
      },
      from: vi.fn(() => {
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          order: vi.fn(() => query),
          limit: vi.fn(() => query),
          abortSignal: vi.fn(() => query),
          maybeSingle: vi.fn().mockImplementation(async () => {
            maybeSingleCalls += 1;
            // Calls 1–2: fast-path primary + latest miss. After route timeout,
            // calls 3–4: primary miss then latest row hit.
            if (maybeSingleCalls <= 3) return { data: null, error: null };
            return { data: row, error: null };
          }),
        };
        return query;
      }),
    });

    const promise = fetchGlobalContent({
      userLocation: { lat: 52.52, lng: 13.405, timezone: "Europe/Berlin" },
      responseLocale: "de",
    });

    await vi.advanceTimersByTimeAsync(25_000);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getSupabaseAccessTokenMock).toHaveBeenCalled();
    expect(result.forecast.slogan).toBe("DE slogan");
    expect(result.forecast.recommendationShortText).toBe("DE short");
    expect(result.forecast.recommendationLongText).toBe(buildStructuredLong("DE"));
    expect(result.modelUsed).toBe("gemini-test");
  });

  it("drops legacy long explanation during direct read", async () => {
    const row = buildGlobalContentRow();
    row.text_i18n = {
      de: {
        slogan: "DE slogan",
        short_text: "DE short",
        long_explanation: "Mars speaks through chakra language without structured sections.",
      },
    };
    requireSupabaseMock.mockReturnValue(createSupabaseMock(row));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGlobalContent({
      userLocation: { lat: 52.52, lng: 13.405, timezone: "Europe/Berlin" },
      responseLocale: "de",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.forecast.recommendationLongText).toBeUndefined();
    expect(result.forecast.recommendationShortText).toBe("DE short");
  });
});
