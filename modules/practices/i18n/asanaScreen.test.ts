import { describe, expect, it } from "vitest";

import { getAsanaScreenStrings } from "@/modules/practices/i18n/asanaScreen";
import { getConnectTvStrings, getTvRemoteStrings } from "@/modules/remote-play/i18n/remotePlay";

describe("asana + remote-play locale overlays", () => {
  it("localizes the phone asana complete button for Portuguese", () => {
    expect(getAsanaScreenStrings("pt").completeButton).toBe("Concluir prática");
    expect(getAsanaScreenStrings("ru").completeButton).toBe("Завершить практику");
    expect(getAsanaScreenStrings("en").completeButton).toBe("Complete practice");
  });

  it("localizes the TV remote chrome and uses compact ?pt URLs", () => {
    const pt = getTvRemoteStrings("pt");
    expect(pt.meta("RHLD")).toBe("Comando TV · código RHLD");
    expect(pt.pauseButton).toBe("Pausa");
    expect(pt.tvUrl).toBe("https://zamkovoi.yoga/tv?pt");
    expect(pt.openOnTvCaption).toMatch(/televisão|computador/i);
    expect(getConnectTvStrings("pt").description).toContain("https://zamkovoi.yoga/tv?pt");
    expect(getConnectTvStrings("ru").description).toContain("https://zamkovoi.yoga/tv");
    expect(getConnectTvStrings("ru").description).not.toContain("?pt");
  });
});
