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
});

describe("stripDialogScaffoldMarkdown", () => {
  it("keeps ordinary text after removing scaffold markdown", () => {
    expect(stripDialogScaffoldMarkdown("**Заголовок**\n\nТекст")).toBe("Текст");
  });
});
