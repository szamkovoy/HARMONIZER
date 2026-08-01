import { describe, expect, it } from "vitest";

import { localizeMathLevelMarkdown } from "./mathLevelI18n";

describe("localizeMathLevelMarkdown", () => {
  it("rewrites English planet keys for RU while keeping surrounding copy", () => {
    const source = [
      "### 1. Сила (S) и гармоничность (H) планет",
      "",
      "**Sun** (чакра 7):",
      "- S натальная: 0.62",
      "**Moon** (чакра 1):",
      "- Sun: ΔS=+0.10",
    ].join("\n");

    const out = localizeMathLevelMarkdown(source, "ru");

    expect(out).toContain("**Солнце** (чакра 7):");
    expect(out).toContain("**Луна** (чакра 1):");
    expect(out).toContain("- Солнце: ΔS=+0.10");
    expect(out).not.toContain("**Sun**");
    expect(out).not.toContain("**Moon**");
  });

  it("rewrites aspect keys for DE and leaves EN labels unchanged", () => {
    const source = "\n- Transiting **Mars** conjunction natal **Sun**\n";
    expect(localizeMathLevelMarkdown(source, "de")).toContain(" Konjunktion ");
    expect(localizeMathLevelMarkdown(source, "en")).toContain(" conjunction ");
    expect(localizeMathLevelMarkdown(source, "en")).toContain("**Mars**");
  });

  it("localizes planet labels for FR/IT/ES/PT/NL", () => {
    const source = "**Mercury** (chakra 6):";
    expect(localizeMathLevelMarkdown(source, "fr")).toContain("**Mercure**");
    expect(localizeMathLevelMarkdown(source, "it")).toContain("**Mercurio**");
    expect(localizeMathLevelMarkdown(source, "es")).toContain("**Mercurio**");
    expect(localizeMathLevelMarkdown(source, "pt")).toContain("**Mercurio**");
    expect(localizeMathLevelMarkdown(source, "nl")).toContain("**Mercurius**");
  });
});
