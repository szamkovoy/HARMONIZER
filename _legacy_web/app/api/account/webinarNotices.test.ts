import { describe, expect, it } from "vitest";

import {
  authoredRecordingLetter,
  buildNoticePlainText,
  fillLetterName,
  letterLocale,
  purchaseLetterLocale,
  RECORDING_LETTER_BODY,
  RECORDING_LETTER_SUBJECT,
} from "../_utils/webinarNoticeCopy";
import {
  instantInHalfOpenWindow,
  isActiveMaster,
  masterCoveredStart,
  passCoveredWebinar,
  recordingRecipientIds,
  startsStillOpen,
  ticketCoveredStart,
} from "./webinarNotices";
import { marketingStatusAfterPurchase } from "./widgetFulfillment";

const START = "2026-10-20T15:00:00.000Z";

describe("recording letter is the authored text", () => {
  it("keeps the Russian template as the whole letter", () => {
    expect(RECORDING_LETTER_SUBJECT).toBe("Запись вебинара");
    expect(RECORDING_LETTER_BODY).toContain("{{name}}");
    expect(RECORDING_LETTER_BODY).toContain("Сергей Замковой");
    const letter = authoredRecordingLetter("de", RECORDING_LETTER_SUBJECT, {}, RECORDING_LETTER_BODY, {});
    expect(letter).toEqual({
      locale: "ru",
      subject: RECORDING_LETTER_SUBJECT,
      body: RECORDING_LETTER_BODY,
    });
  });

  it("uses a translation only when both subject and body exist", () => {
    expect(
      authoredRecordingLetter(
        "de",
        RECORDING_LETTER_SUBJECT,
        { de: "Aufzeichnung" },
        RECORDING_LETTER_BODY,
        { de: "Hallo, {{name}}!\n\nDer Link." },
      )?.locale,
    ).toBe("de");
  });

  it("replaces the name and keeps the blank lines", () => {
    expect(fillLetterName("Здравствуйте, {{name}}!\n\nТекст", "Анна")).toBe("Здравствуйте, Анна!\n\nТекст");
    expect(fillLetterName("Здравствуйте, {{name}}!\n\nТекст", "")).toBe("Здравствуйте!\n\nТекст");
  });
});

describe("letter language is never mixed", () => {
  const i18n = { de: "Der Webinar-Text", en: "The webinar text" };

  it("uses the translation when that language has its own text", () => {
    expect(letterLocale("de", "Русский текст", i18n)).toEqual({
      locale: "de",
      text: "Der Webinar-Text",
    });
  });

  it("falls back to a fully Russian letter when the translation is missing", () => {
    expect(letterLocale("fr", "Русский текст", i18n)).toEqual({
      locale: "ru",
      text: "Русский текст",
    });
  });

  it("builds the French letter without Russian phrases", () => {
    const { subject, text } = buildNoticePlainText({
      kind: "invite",
      locale: "fr",
      name: "Anne",
      body: "Le texte du webinaire",
      joinUrl: "https://example.com/room",
    });
    expect(subject).toBe("Je vous invite au webinaire");
    expect(text).toContain("Bonjour Anne !");
    expect(text).toContain("Le texte du webinaire");
    expect(text).toContain("https://example.com/room");
    expect(text).toContain("À bientôt !");
    expect(text).not.toMatch(/Здравствуйте|До встречи|Приглашаю/);
  });

  it("builds the Russian letter with the greeting, the room link and the sign-off", () => {
    const { subject, text } = buildNoticePlainText({
      kind: "invite",
      locale: "ru",
      name: "Анна",
      body: "Описание вебинара",
      joinUrl: "https://example.com/room",
    });
    expect(subject).toBe("Приглашаю на вебинар");
    expect(text).toContain("Здравствуйте, Анна!");
    expect(text).toContain("Описание вебинара");
    expect(text).toContain("https://example.com/room");
    expect(text).toContain("До встречи!\nСергей Замковой");
  });

  it("omits the name when it is empty", () => {
    const { text } = buildNoticePlainText({
      kind: "recording",
      locale: "ru",
      name: "  ",
      body: "Текст записи",
    });
    expect(text.startsWith("Здравствуйте!")).toBe(true);
    expect(text).not.toContain("Здравствуйте,");
    expect(text).toContain("Текст записи");
  });
});

describe("purchase letter locale", () => {
  const subjects = { ru: "Тема", de: "Betreff" };
  const bodies = { ru: "Текст", de: "" };

  it("does not pair a German subject with a Russian body", () => {
    expect(purchaseLetterLocale("de", subjects, bodies)).toBe("ru");
  });

  it("keeps German when both parts exist", () => {
    expect(purchaseLetterLocale("de", subjects, { ru: "Текст", de: "Text" })).toBe("de");
  });

  it("sends nothing when neither the recipient language nor Russian is complete", () => {
    expect(purchaseLetterLocale("fr", { de: "Betreff" }, { de: "Text" })).toBeNull();
  });
});

describe("who had paid for the webinar when it started", () => {
  it("counts a Master whose period covered the start", () => {
    expect(
      masterCoveredStart({
        status: "active",
        createdAt: "2026-10-01T00:00:00.000Z",
        periodEnd: "2026-11-01T00:00:00.000Z",
        startsAt: START,
      }),
    ).toBe(true);
    expect(
      masterCoveredStart({
        status: "active",
        createdAt: "2026-10-21T00:00:00.000Z",
        periodEnd: "2026-11-21T00:00:00.000Z",
        startsAt: START,
      }),
    ).toBe(false);
  });

  it("counts a pass only while a credit was still free", () => {
    expect(
      passCoveredWebinar({
        status: "active",
        credits: 1,
        validFrom: "2026-10-18T00:00:00.000Z",
        validUntil: "2026-10-25T00:00:00.000Z",
        startsAt: START,
        earlierRegistrations: 1,
        registeredForThis: false,
      }),
    ).toBe(false);
    expect(
      passCoveredWebinar({
        status: "active",
        credits: 4,
        validFrom: "2026-10-18T00:00:00.000Z",
        validUntil: "2026-11-15T00:00:00.000Z",
        startsAt: START,
        earlierRegistrations: 1,
        registeredForThis: false,
      }),
    ).toBe(true);
  });

  it("keeps someone who was registered even if the pass was later revoked", () => {
    expect(
      passCoveredWebinar({
        status: "revoked",
        credits: 1,
        validFrom: "2026-10-18T00:00:00.000Z",
        validUntil: "2026-10-25T00:00:00.000Z",
        startsAt: START,
        earlierRegistrations: 0,
        registeredForThis: true,
      }),
    ).toBe(true);
  });

  it("collects Master, a ticket and a pass, and skips a late Master", () => {
    const ids = recordingRecipientIds({
      startsAt: START,
      webinarId: "w1",
      masters: [
        {
          userId: "master",
          status: "active",
          createdAt: "2026-10-01T00:00:00.000Z",
          periodEnd: "2026-11-01T00:00:00.000Z",
        },
        {
          userId: "late",
          status: "active",
          createdAt: "2026-10-21T00:00:00.000Z",
          periodEnd: "2026-11-21T00:00:00.000Z",
        },
      ],
      tickets: [
        { userId: "ticket", status: "active", createdAt: "2026-10-19T00:00:00.000Z" },
        { userId: "refunded-ticket", status: "refunded", createdAt: "2026-10-19T00:00:00.000Z" },
      ],
      passes: [
        {
          id: "p1",
          userId: "pass",
          status: "active",
          credits: 4,
          validFrom: "2026-10-01T00:00:00.000Z",
          validUntil: "2026-10-29T00:00:00.000Z",
        },
      ],
      passRegistrations: [],
    });
    expect(ids.sort()).toEqual(["master", "pass", "ticket"]);
  });

  it("a one-time ticket bought after the start does not count", () => {
    expect(
      ticketCoveredStart({ status: "active", createdAt: "2026-10-21T00:00:00.000Z", startsAt: START }),
    ).toBe(false);
  });
});

describe("invite window", () => {
  const now = new Date("2026-10-20T16:00:00.000Z");

  it("still invites during the hour after the start", () => {
    expect(startsStillOpen("2026-10-20T15:30:00.000Z", now)).toBe(true);
    expect(startsStillOpen("2026-10-20T14:00:00.000Z", now)).toBe(false);
  });

  it("a webinar inside the pass window blocks the product letter", () => {
    expect(
      instantInHalfOpenWindow(
        "2026-10-22T10:00:00.000Z",
        "2026-10-20T00:00:00.000Z",
        "2026-10-27T00:00:00.000Z",
      ),
    ).toBe(true);
    expect(
      instantInHalfOpenWindow(
        "2026-11-01T10:00:00.000Z",
        "2026-10-20T00:00:00.000Z",
        "2026-10-27T00:00:00.000Z",
      ),
    ).toBe(false);
  });

  it("trial and Oracle are not Master", () => {
    expect(isActiveMaster("master", "2026-11-01T00:00:00.000Z", now)).toBe(true);
    expect(isActiveMaster("oracle", "2026-11-01T00:00:00.000Z", now)).toBe(false);
    expect(isActiveMaster("free", "2026-11-01T00:00:00.000Z", now)).toBe(false);
    expect(isActiveMaster("master", "2026-10-01T00:00:00.000Z", now)).toBe(false);
  });
});

describe("purchase resubscribe", () => {
  it("turns only an unsubscribed contact back on", () => {
    expect(marketingStatusAfterPurchase("unsubscribed")).toBe("active");
    expect(marketingStatusAfterPurchase("active")).toBe("active");
    expect(marketingStatusAfterPurchase("complained")).toBe("complained");
    expect(marketingStatusAfterPurchase("suppressed")).toBe("suppressed");
  });
});
