import { describe, expect, it } from "vitest";

import { assessDueEventSummary, likelyAnsweredDueEventIds, shouldRetryForMissingSummaryMarker } from "./summaryRepair";

describe("assessDueEventSummary", () => {
  it("treats happened event without lived state as insufficient", () => {
    expect(
      assessDueEventSummary("Да, съездил в автосервис, всё сделал, но долго ждал."),
    ).toBe("occurred_without_state");
  });

  it("detects happened event with explicit inner state", () => {
    expect(
      assessDueEventSummary("Да, встреча состоялась, и я проживал её спокойно и уверенно."),
    ).toBe("occurred_with_state");
  });

  it("detects events that did not happen", () => {
    expect(
      assessDueEventSummary("Нет, фильм посмотреть не успел, не получилось."),
    ).toBe("not_occurred");
  });
});

describe("shouldRetryForMissingSummaryMarker", () => {
  const dueEvents = [
    {
      id: "evt-1",
      description: "Поехать в автосервис",
    },
  ] as unknown as Parameters<typeof likelyAnsweredDueEventIds>[1];

  it("does not force summary repair when state is still missing", () => {
    expect(
      shouldRetryForMissingSummaryMarker({
        branches: ["summarizing"],
        summarizeEventsCount: 0,
        userMessage: "Да, съездил, всё сделал, но долго ждал.",
        dueEvents,
      }),
    ).toBe(false);
  });

  it("still allows summary repair for explicit non-occurrence", () => {
    expect(
      shouldRetryForMissingSummaryMarker({
        branches: ["summarizing"],
        summarizeEventsCount: 0,
        userMessage: "Нет, не успел съездить.",
        dueEvents,
      }),
    ).toBe(true);
  });

  it("still matches due event ids on plain factual answer", () => {
    expect(
      likelyAnsweredDueEventIds("Да, в автосервис съездил, всё получилось.", dueEvents),
    ).toEqual(["evt-1"]);
  });
});
