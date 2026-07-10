import { describe, expect, it } from "vitest";

import { getHomeStrings } from "@/modules/home/i18n/home";
import { loadOpportunityWindowsExplanation } from "@/services/opportunityWindowsExplanation";
import type { DailyForecast } from "@/modules/daily-engine";

const windows: DailyForecast["windowsOfOpportunity"] = {
  sunrise: { time: "2026-07-10T01:30:00.000Z", planet: "Mars" },
  culmination: { time: "2026-07-10T10:00:00.000Z", planet: "Mars" },
  exactAspect: {
    time: "2026-07-10T11:22:00.000Z",
    aspectType: "trine",
    toNatalPlanet: "Moon",
    transitPlanet: "Mars",
  },
};

describe("loadOpportunityWindowsExplanation", () => {
  it("builds paid RU help without planet declension", async () => {
    const text = await loadOpportunityWindowsExplanation({
      accessMode: "premium",
      planetOfTheDay: "Moon",
      windows,
      strings: getHomeStrings("ru"),
    });
    expect(text).toContain("Сильнейшей планетой вашей натальной карты сегодня является Луна.");
    expect(text).toContain("транзитной планетой Марс");
    expect(text).toContain("трин Марс и Луна.");
    expect(text).not.toContain("трин Марс к Луна");
    expect(text).toContain("Нажмите колокольчик под графиком");
  });

  it("localizes paid IT help and aspect phrasing", async () => {
    const strings = getHomeStrings("it");
    expect(strings.opportunityWindows.title).toBe("Finestre di opportunità");
    expect(
      strings.opportunityWindows.paidIntro(strings.planetLabels.Moon, strings.planetLabels.Mars),
    ).toContain("Luna");
    expect(
      strings.opportunityWindows.paidIntro(strings.planetLabels.Moon, strings.planetLabels.Mars),
    ).toContain("Marte");
    expect(
      strings.opportunityWindows.exactAspectDetail(
        strings.opportunityWindows.aspectLabels.trine,
        strings.planetLabels.Mars,
        strings.planetLabels.Moon,
      ),
    ).toBe("trigono Marte e Luna");

    const text = await loadOpportunityWindowsExplanation({
      accessMode: "premium",
      planetOfTheDay: "Moon",
      windows,
      strings,
    });
    expect(text).toContain("Il pianeta più forte della vostra carta natale oggi è Luna.");
    expect(text).toContain("trigono Marte e Luna");
    expect(text).not.toContain("The natal anchor");
    expect(text).not.toContain("to Moon");
  });

  it("keeps free path on localized templates", async () => {
    const text = await loadOpportunityWindowsExplanation({
      accessMode: "free",
      planetOfTheDay: "Moon",
      windows: {
        sunrise: windows.sunrise,
        culmination: windows.culmination,
        exactAspect: null,
      },
      strings: getHomeStrings("it"),
    });
    expect(text).toContain("Il pianeta più forte del giorno è Luna.");
    expect(text).not.toContain("The strongest planet");
    expect(text).toContain("Tocca la campana sotto il grafico");
  });
});
