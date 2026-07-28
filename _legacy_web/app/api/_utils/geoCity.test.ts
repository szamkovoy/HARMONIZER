import { describe, expect, it } from "vitest";

import {
  cityFromLocationName,
  districtCenterFromAdminLabel,
  locationSuggestsDistrictContext,
  looksLikeDistrictName,
  pickSettlementCity,
  pickUrbanCity,
  repairCityField,
} from "./geoCity";

describe("geoCity", () => {
  it("rejects municipality labels", () => {
    expect(looksLikeDistrictName("Осташковский муниципальный округ")).toBe(true);
    expect(looksLikeDistrictName("Осташков")).toBe(false);
  });

  it("prefers town over village and municipality", () => {
    expect(
      pickUrbanCity({
        town: "Осташков",
        village: "Заречье",
        municipality: "Осташковский муниципальный округ",
      }),
    ).toBe("Осташков");
    expect(
      pickSettlementCity({
        village: "Заречье",
        municipality: "Осташковский муниципальный округ",
      }),
    ).toBe("Заречье");
  });

  it("repairs city from location_name", () => {
    expect(
      repairCityField({
        city: "Осташковский муниципальный округ",
        location_name: "Осташков, Осташковский муниципальный округ, Тверская область, Россия",
      }),
    ).toBe("Осташков");
    expect(
      cityFromLocationName(
        "Осташков, Осташковский муниципальный округ, Тверская область, Россия",
      ),
    ).toBe("Осташков");
  });

  it("detects district context in location_name", () => {
    expect(
      locationSuggestsDistrictContext(
        "Заречье, Осташковский муниципальный округ, Тверская область, Россия",
      ),
    ).toBe(true);
  });

  it("derives district centre from admin label", () => {
    expect(districtCenterFromAdminLabel("Осташковский муниципальный округ")).toBe(
      "Осташков",
    );
    expect(districtCenterFromAdminLabel("Клинский район")).toBe("Клин");
    expect(districtCenterFromAdminLabel("Заречье")).toBe(null);
  });
});
