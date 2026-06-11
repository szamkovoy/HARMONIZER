import { describe, expect, it } from "vitest";
import {
  buildCalibrationCompact,
  buildForecastCompact,
  buildHistoryCompact,
  buildProfileCompact,
  buildResponderForecastCompact,
  buildResponderProfileCompact,
  buildStatesMapCompact,
  logDTOSize,
  responderThemeLabel,
} from "./dto";

const planets = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"] as const;

function mockNatal(overrides: Record<string, { S_initial?: number; H_initial?: number }> = {}) {
  return {
    precisionMode: "precise" as const,
    planets: Object.fromEntries(
      planets.map((planet) => [
        planet,
        {
          S_initial: overrides[planet]?.S_initial ?? 0.5,
          H_initial: overrides[planet]?.H_initial ?? 0,
        },
      ]),
    ),
  };
}

function mockStatesMap() {
  return Object.fromEntries(
    planets.map((planet) => [
      planet,
      {
        positive_states: [
          { label: `${planet} confirmed positive`, source: "user_confirmed" },
          { label: `${planet} added positive`, source: "user_added" },
          { label: `${planet} baseline positive`, source: "baseline" },
          { label: `${planet} extra positive`, source: "baseline" },
        ],
        negative_states: [
          { label: `${planet} confirmed negative`, source: "user_confirmed" },
          { label: `${planet} added negative`, source: "user_added" },
          { label: `${planet} baseline negative`, source: "baseline" },
          { label: `${planet} extra negative`, source: "baseline" },
        ],
        rejected_states: [{ label: `${planet} rejected` }],
      },
    ]),
  );
}

describe("buildProfileCompact", () => {
  it("includes all 7 chakras with rounded values", () => {
    const dto = buildProfileCompact(mockNatal({ Sun: { S_initial: 0.6666, H_initial: 0.2222 } }), null, {
      display_name: "Test",
      birth_date: "1990-01-01T00:00:00Z",
    });

    expect(Object.keys(dto.chakras)).toHaveLength(7);
    expect(dto.name).toBe("Test");
    expect(dto.birthDate).toBe("1990-01-01");
    expect(dto.chakras[7].strength).toBe(0.67);
    expect(dto.chakras[7].harmony).toBe(0.22);
  });

  it("includes flags only when values differ significantly", () => {
    const weak = buildProfileCompact(mockNatal({ Sun: { S_initial: 0.2, H_initial: 0 } }), null);
    expect(weak.chakras[7].flag).toBe("weak");

    const average = buildProfileCompact(mockNatal({ Sun: { S_initial: 0.5, H_initial: 0 } }), null);
    expect(average.chakras[7].flag).toBeUndefined();
  });

  it("uses calibrated values when available", () => {
    const dto = buildProfileCompact(mockNatal(), { s_calibrated: { Sun: 0.85 }, h_calibrated: { Sun: 0.31 } }, {});

    expect(dto.isCalibrated).toBe(true);
    expect(dto.chakras[7].strength).toBe(0.85);
    expect(dto.chakras[7].harmony).toBe(0.31);
  });
});

describe("buildResponderProfileCompact", () => {
  it("omits raw planet names and keeps user-facing themes", () => {
    const dto = buildResponderProfileCompact(mockNatal(), null, { display_name: "Test" });

    expect(dto.name).toBe("Test");
    expect(dto.centers[5]).toMatchObject({
      theme: "ценности и самовыражение",
      strength: 0.5,
      harmony: 0,
    });
    expect(JSON.stringify(dto)).not.toContain("\"Saturn\"");
  });
});

describe("buildForecastCompact", () => {
  it("excludes raw forecast fields", () => {
    const dto = buildForecastCompact({
      forecast_date: "2026-04-29",
      planet_of_the_day: "Moon",
      today_planet_state: { todayTone: "harmonic", naturalHarmoniousness: 0.456 },
      importance: { Moon: 0.789 },
      is_alternative_choice: true,
      windows_of_opportunity: { sunrise: { time: "2026-04-29T03:15:00Z" } },
      transit_chart: { raw: true },
    } as never);

    expect(dto).toMatchObject({
      date: "2026-04-29",
      planet: "Moon",
      chakra: 1,
      shortLabel: "safety",
      tone: "harmonic",
      H: 0.46,
      S: 0.79,
      isAlternativeChoice: true,
    });
    expect(dto).not.toHaveProperty("transit_chart");
    expect(dto?.windows.sunrise).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("buildResponderForecastCompact", () => {
  it("replaces astro labels with user-facing daily theme", () => {
    const dto = buildResponderForecastCompact({
      forecast_date: "2026-04-29",
      planet_of_the_day: "Moon",
      today_planet_state: { todayTone: "harmonic", naturalHarmoniousness: 0.456 },
      importance: { Moon: 0.789 },
      is_alternative_choice: true,
      windows_of_opportunity: { sunrise: { time: "2026-04-29T03:15:00Z" } },
    });

    expect(dto).toMatchObject({
      date: "2026-04-29",
      theme: "тело и безопасность",
      tone: "harmonic",
      H: 0.46,
      S: 0.79,
      isAlternativeChoice: true,
    });
    expect(JSON.stringify(dto)).not.toContain("\"Moon\"");
  });
});

describe("buildCalibrationCompact", () => {
  it("keeps only state summaries and top phrases", () => {
    const dto = buildCalibrationCompact({
      version: 3,
      states_map: mockStatesMap(),
      user_lexicon: {
        phrases: Array.from({ length: 12 }, (_, index) => ({
          text: `phrase ${index}`,
          associated_planet: "Sun",
          frequency: index,
        })),
      },
      portrait: "long portrait",
      portrait_chunks: { a: "chunk" },
    } as never);

    expect(dto?.version).toBe(3);
    expect(dto?.statesSummary.Sun.positive).toHaveLength(3);
    expect(dto?.statesSummary.Sun.negative).toHaveLength(3);
    expect(dto?.topPhrases).toHaveLength(10);
    expect(dto).not.toHaveProperty("portrait");
    expect(dto).not.toHaveProperty("portrait_chunks");
  });
});

describe("buildHistoryCompact", () => {
  it("respects char budget", () => {
    const messages = Array.from({ length: 50 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: "a".repeat(500),
    }));

    const dto = buildHistoryCompact(messages, 5250);

    const totalChars = dto.messages.reduce((sum, message) => sum + message.text.length + 50, 0);
    expect(totalChars).toBeLessThanOrEqual(5250);
    expect(dto.truncated).toBe(true);
  });

  it("keeps last messages when truncating", () => {
    const dto = buildHistoryCompact(
      [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "third" },
      ],
      200,
    );

    expect(dto.messages.at(-1)?.text).toBe("third");
  });
});

describe("buildStatesMapCompact and logDTOSize", () => {
  it("splits confirmed, user-added, and rejected states", () => {
    const dto = buildStatesMapCompact(mockStatesMap());

    expect(dto.Sun.confirmedPositive).toEqual(["Sun confirmed positive"]);
    expect(dto.Sun.confirmedNegative).toEqual(["Sun confirmed negative"]);
    expect(dto.Sun.userAdded).toEqual(["Sun added positive", "Sun added negative"]);
    expect(dto.Sun.rejected).toEqual(["Sun rejected"]);
  });

  it("returns approximate JSON size and tokens", () => {
    const size = logDTOSize("test", { text: "hello" }, 100);

    expect(size.chars).toBeGreaterThan(0);
    expect(size.tokens).toBeGreaterThan(0);
  });

  it("maps planets to user-facing responder themes", () => {
    expect(responderThemeLabel("Saturn")).toBe("ценности и самовыражение");
    expect(responderThemeLabel("unknown")).toBe("высшие смыслы, вера");
  });
});
