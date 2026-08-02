import { describe, expect, it } from "vitest";

import {
  closedLineCountWhileTyping,
  splitAssistantLines,
} from "@/modules/communicator/ui/assistantLineReveal";

describe("splitAssistantLines", () => {
  it("returns empty for empty text", () => {
    expect(splitAssistantLines("")).toEqual([]);
  });

  it("keeps a single paragraph as one line", () => {
    expect(splitAssistantLines("Hello there")).toEqual(["Hello there"]);
  });

  it("splits on newlines and drops trailing empty segment", () => {
    expect(splitAssistantLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitAssistantLines("a\nb")).toEqual(["a", "b"]);
  });
});

describe("closedLineCountWhileTyping", () => {
  it("buffers open tail without a newline", () => {
    expect(closedLineCountWhileTyping("Hello")).toBe(0);
    expect(closedLineCountWhileTyping("Hello wor")).toBe(0);
  });

  it("counts only closed lines", () => {
    expect(closedLineCountWhileTyping("a\n")).toBe(1);
    expect(closedLineCountWhileTyping("a\nb\nc")).toBe(2);
  });
});
