import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../public/widget.js"),
  "utf8",
);

function boot(href: string) {
  const replaced: string[] = [];
  const history = {
    state: { kept: true },
    replaceState(state: unknown, _title: string, next: string) {
      replaced.push(next);
      this.state = state as { kept: boolean };
      window.location.href = next;
    },
  };
  const document = {
    currentScript: null,
    readyState: "complete",
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
  };
  const window = {
    history,
    location: { href },
    navigator: { language: "ru", languages: ["ru"] },
    document,
  } as Window & { __hzPaidReturnId?: string | null };
  const context = createContext({
    window,
    document,
    navigator: window.navigator,
    history,
    URL,
    Intl,
  });
  runInContext(source, context);
  return {
    replaced,
    paidId: window.__hzPaidReturnId,
    state: history.state,
    reload() {
      runInContext(source, context);
    },
  };
}

describe("widget paid return", () => {
  it("shows thanks for this load only and drops hz_paid from the address", () => {
    const page = boot("https://site.ru/landing?utm=1&hz_paid=w1#form");
    expect(page.paidId).toBe("w1");
    expect(page.replaced).toEqual(["https://site.ru/landing?utm=1#form"]);
    expect(page.state).toEqual({ kept: true });

    page.reload();
    expect(page.paidId).toBe("w1");
    expect(page.replaced).toEqual(["https://site.ru/landing?utm=1#form"]);
  });

  it("leaves a page without hz_paid on the payment form", () => {
    const page = boot("https://site.ru/landing?utm=1#form");
    expect(page.paidId).toBeNull();
    expect(page.replaced).toEqual([]);
  });

  it("drops a lone hz_paid parameter without a trailing question mark", () => {
    const page = boot("https://site.ru/landing?hz_paid=w1");
    expect(page.replaced).toEqual(["https://site.ru/landing"]);
  });
});
