import { describe, expect, it } from "vitest";

import {
  emailCopyName,
  emailListSubjectSubtitle,
  emailListTitle,
} from "./emailNaming";

describe("emailNaming", () => {
  it("list title prefers name over subject", () => {
    expect(emailListTitle("Моё письмо", "Тема")).toBe("Моё письмо");
    expect(emailListTitle("", "Тема")).toBe("Тема");
    expect(emailListTitle("  ", "  ")).toBe("Без названия");
  });

  it("subject subtitle only when both present", () => {
    expect(emailListSubjectSubtitle("Name", "Subject")).toBe("Subject");
    expect(emailListSubjectSubtitle("", "Subject")).toBeNull();
  });

  it("copy appends (копия)", () => {
    expect(emailCopyName("Привет", "Тема")).toBe("Привет (копия)");
    expect(emailCopyName("", "Тема")).toBe("Тема (копия)");
    expect(emailCopyName("", "", "Письмо")).toBe("Письмо (копия)");
  });
});
