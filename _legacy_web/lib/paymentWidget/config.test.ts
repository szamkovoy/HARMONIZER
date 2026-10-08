import { describe, expect, it } from "vitest";

import {
  defaultWidgetMethod,
  internationalCurrency,
  normalizeWidgetConfig,
  pickRequestedLocale,
  resolveWidgetLocale,
  resolveWidgetTexts,
} from "./config";
import { WIDGET_LOCALES, getWidgetEditableDefaults, getWidgetSystemTexts } from "./copy";

describe("widget default copy", () => {
  it.each(WIDGET_LOCALES)("has every editable and system text in %s", (locale) => {
    const editable = getWidgetEditableDefaults(locale);
    for (const key of ["namePlaceholder", "emailPlaceholder", "button", "methodRu", "methodInt", "perMonth", "thanksTitle", "thanksBody"] as const) {
      expect(editable[key].trim()).not.toBe("");
    }
    for (const value of Object.values(getWidgetSystemTexts(locale))) {
      expect(value.trim()).not.toBe("");
    }
  });
});

describe("normalizeWidgetConfig", () => {
  it("fills defaults and keeps email/button visible", () => {
    const config = normalizeWidgetConfig({
      paymentMode: "weird",
      elements: [{ type: "email", visible: false }, { type: "title", visible: false }, { type: "nope" }],
      style: { radius: 999, background: "url(javascript:x)", fontFamily: "Arial; }</style>" },
      successUrl: "javascript:alert(1)",
    });
    expect(config.paymentMode).toBe("choice");
    expect(config.elements[0]).toEqual({ type: "email", visible: true });
    expect(config.elements[1]).toEqual({ type: "title", visible: false });
    expect(config.elements).toHaveLength(8);
    expect(config.style.radius).toBe(40);
    expect(config.style.background).toBe("#ffffff");
    expect(config.style.fontFamily).toBe("inherit");
    expect(config.successUrl).toBeNull();
  });
});

describe("resolveWidgetLocale", () => {
  const config = normalizeWidgetConfig({
    texts: {
      ru: { title: "Вебинар", text: "Описание" },
      en: { title: "Webinar", text: "Description" },
      de: { title: "Webinar" },
    },
  });

  it.each([
    ["en", "en"],
    ["de", "ru"],
    ["fr", "ru"],
    [null, "ru"],
  ] as const)("requested %s → shown %s", (requested, shown) => {
    expect(resolveWidgetLocale(config, requested)).toBe(shown);
  });

  it("uses locale defaults for texts the author did not write", () => {
    const texts = resolveWidgetTexts(config, "en");
    expect(texts.title).toBe("Webinar");
    expect(texts.button).toBe("Pay");
    expect(resolveWidgetTexts(config, "ru").button).toBe("Оплатить");
  });

  it("any locale works when the author kept only standard texts", () => {
    const plain = normalizeWidgetConfig({});
    for (const locale of WIDGET_LOCALES) expect(resolveWidgetLocale(plain, locale)).toBe(locale);
  });
});

describe("pickRequestedLocale", () => {
  it("prefers data-lang, else the first supported browser language", () => {
    expect(pickRequestedLocale("de", ["en-US"])).toBe("de");
    expect(pickRequestedLocale("auto", ["ja-JP", "pt-BR", "en"])).toBe("pt");
    expect(pickRequestedLocale(null, ["ja"])).toBeNull();
    expect(pickRequestedLocale("xx", ["en"])).toBeNull();
  });
});

describe("default method and currency", () => {
  it("RU → Russian card, other or unknown → international", () => {
    expect(defaultWidgetMethod({ country: "RU", timeZone: null })).toBe("ru");
    expect(defaultWidgetMethod({ country: "DE", timeZone: "Europe/Moscow" })).toBe("int");
    expect(defaultWidgetMethod({ country: null, timeZone: null })).toBe("int");
  });

  it("falls back to the browser time zone when the country is unknown", () => {
    expect(defaultWidgetMethod({ country: "", timeZone: "Asia/Novosibirsk" })).toBe("ru");
    expect(defaultWidgetMethod({ country: "", timeZone: "Europe/Berlin" })).toBe("int");
  });

  it("USD for the US, EUR otherwise", () => {
    expect(internationalCurrency("US")).toBe("USD");
    expect(internationalCurrency("GB")).toBe("EUR");
    expect(internationalCurrency(null)).toBe("EUR");
  });
});
