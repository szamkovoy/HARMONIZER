import { describe, expect, it } from "vitest";

import { stripDialogScaffoldMarkdown, stripInternalDialogMarkers } from "./dialogTextCleanup";

describe("stripInternalDialogMarkers", () => {
  it("removes bare internal markers from visible assistant text", () => {
    const text = [
      "1. Поход в кино",
      "Рекомендация: Смотрите фильм внимательно.",
      "",
      "[CORRECT_RECOMMENDATION]",
      "[READY_FOR_RECOMMENDATION]",
    ].join("\n");

    expect(stripInternalDialogMarkers(text)).toBe(
      "1. Поход в кино\nРекомендация: Смотрите фильм внимательно.",
    );
  });

  it("removes XML-style protocol tags and leftover attributes from streamed text", () => {
    const text = [
      `display_order="2" spheres="4:1"></PLANNED_EVENT>`,
      "Sounds like a focused and engaging day.",
      `<PLANNED_EVENT: desc="Go to the lake" recommendation="Stay present." display_order="1" spheres="1:1"></PLANNED_EVENT>`,
    ].join("\n");

    expect(stripInternalDialogMarkers(text)).toBe("Sounds like a focused and engaging day.");
  });
});

describe("stripDialogScaffoldMarkdown", () => {
  it("keeps ordinary text after removing scaffold markdown", () => {
    expect(stripDialogScaffoldMarkdown("**Заголовок**\n\nТекст")).toBe("Текст");
  });
});
