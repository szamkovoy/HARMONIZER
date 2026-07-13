import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchGlobalContentMock = vi.fn();
const saveDayContentCacheMock = vi.fn();
const peekDayContentCacheMock = vi.fn();
const peekDayContentCacheRelaxedMock = vi.fn();

vi.mock("@/services/globalContentClient", () => ({
  fetchGlobalContent: (...args: unknown[]) => fetchGlobalContentMock(...args),
}));

vi.mock("@/services/dayContentCache", () => ({
  peekDayContentCache: (...args: unknown[]) => peekDayContentCacheMock(...args),
  peekDayContentCacheRelaxed: (...args: unknown[]) => peekDayContentCacheRelaxedMock(...args),
  saveDayContentCache: (...args: unknown[]) => saveDayContentCacheMock(...args),
}));

vi.mock("@/services/aiClient", () => ({
  callMonologue: vi.fn(),
}));

vi.mock("@/services/dailyForecastClient", () => ({
  fetchDailyForecast: vi.fn(),
}));

import { ensureLocaleDayContent } from "./localeDayContentEnsure";

function renderableFreeForecast(longText = "") {
  return {
    date: "2026-07-13",
    computedAt: "2026-07-13T08:00:00.000Z",
    cacheValidUntil: "2026-07-13T23:59:59.999Z",
    planetOfTheDay: "Mars",
    todayPlanetState: { naturalHarmoniousness: 0.5, todayTone: "harmonic" },
    windowsOfOpportunity: {},
    transitChart: { referenceTime: "2026-07-13T12:00:00Z", planets: {} },
    importance: {},
    activation: {},
    rankedPlanets: ["Mars"],
    isAlternativeChoice: false,
    slogan: "Слоган дня про внимание к телу",
    recommendationShortText: "Короткий текст рекомендации на сегодня про дыхание и опору.",
    recommendationLongText: longText,
    mathLevel: { markdown: "# math" },
    isGlobal: true,
  };
}

describe("ensureLocaleDayContent free", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    peekDayContentCacheMock.mockReturnValue(null);
    peekDayContentCacheRelaxedMock.mockReturnValue(null);
    saveDayContentCacheMock.mockResolvedValue(undefined);
  });

  it("accepts renderable free texts without long_explanation and does not forceRefresh", async () => {
    fetchGlobalContentMock.mockResolvedValue({
      forecast: renderableFreeForecast(""),
      accessMode: "free",
      isFallback: false,
      modelUsed: "gemini-test",
    });

    const warmed = await ensureLocaleDayContent({
      userId: "user-1",
      locale: "ru",
      accessMode: "free",
      accessTier: "free",
      userLocation: { lat: 55.75, lng: 37.61, timezone: "Europe/Moscow" },
      forceRefresh: false,
    });

    expect(warmed.forecast.slogan).toContain("Слоган");
    expect(fetchGlobalContentMock).toHaveBeenCalledTimes(1);
    expect(fetchGlobalContentMock.mock.calls[0][0].forceRefresh).toBe(false);
  });
});
