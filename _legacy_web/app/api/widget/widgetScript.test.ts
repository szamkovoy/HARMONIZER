import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  } as unknown as Window & { __hzPaidReturnId?: string | null; __hzUnpaidReturnId?: string | null };
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
    unpaidId: window.__hzUnpaidReturnId,
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

  it("remembers hz_unpaid for this load and drops it from the address", () => {
    const page = boot("https://site.ru/landing?utm=1&hz_unpaid=w1#form");
    expect(page.unpaidId).toBe("w1");
    expect(page.replaced).toEqual(["https://site.ru/landing?utm=1#form"]);
  });
});

type MiniNode = {
  tag: string;
  className: string;
  textContent: string;
  children: MiniNode[];
  attrs: Record<string, string>;
  style: { display: string };
  shadow: MiniNode | null;
  listeners: Record<string, Array<(ev?: unknown) => void>>;
  value: string;
  disabled: boolean;
  classList: { add: (name: string) => void; remove: (name: string) => void };
  setAttribute: (key: string, value: string) => void;
  appendChild: (child: MiniNode) => MiniNode;
  removeChild: (child: MiniNode) => void;
  firstChild: MiniNode | null;
  addEventListener: (type: string, fn: (ev?: unknown) => void) => void;
  attachShadow: () => MiniNode;
  shadowRoot: MiniNode | null;
};

function miniNode(tag: string): MiniNode {
  const node = {
    tag,
    className: "",
    textContent: "",
    children: [] as MiniNode[],
    attrs: {} as Record<string, string>,
    style: { display: "" },
    shadow: null as MiniNode | null,
    listeners: {} as Record<string, Array<(ev?: unknown) => void>>,
    value: "",
    disabled: false,
  };
  const self = node as MiniNode;
  self.classList = {
    add(name: string) {
      self.className = `${self.className} ${name}`.trim();
    },
    remove(name: string) {
      self.className = self.className.split(/\s+/).filter((part) => part !== name).join(" ");
    },
  };
  self.setAttribute = (key, value) => {
    self.attrs[key] = value;
  };
  self.appendChild = (child) => {
    self.children.push(child);
    return child;
  };
  self.removeChild = (child) => {
    self.children = self.children.filter((item) => item !== child);
  };
  Object.defineProperty(self, "firstChild", { get: () => self.children[0] ?? null });
  self.addEventListener = (type, fn) => {
    (self.listeners[type] ??= []).push(fn);
  };
  self.attachShadow = () => {
    self.shadow = miniNode("#shadow");
    return self.shadow;
  };
  Object.defineProperty(self, "shadowRoot", { get: () => self.shadow });
  return self;
}

function buttonClasses(host: MiniNode): string[] {
  const classes: string[] = [];
  const walk = (node: MiniNode | null) => {
    if (!node) return;
    if (node.tag === "button") classes.push(node.className);
    node.children.forEach(walk);
    walk(node.shadow);
  };
  walk(host);
  return classes;
}

function methodLabels(host: MiniNode): string[] {
  const labels: string[] = [];
  const walk = (node: MiniNode | null) => {
    if (!node) return;
    if (node.className === "method" || node.className.startsWith("method ")) {
      const span = node.children.find((child) => child.tag === "span");
      labels.push(span?.textContent ?? "");
    }
    node.children.forEach(walk);
    walk(node.shadow);
  };
  walk(host);
  return labels;
}

function renderMethods(data: Record<string, unknown>, applePay: boolean) {
  const document = {
    currentScript: null,
    readyState: "complete",
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
    createElement: (tag: string) => miniNode(tag),
    createTextNode: (text: string) => {
      const node = miniNode("#text");
      node.textContent = String(text);
      return node;
    },
  };
  const window = {
    history: { state: null, replaceState() {} },
    location: { href: "https://site.ru/landing" },
    navigator: { language: "ru", languages: ["ru"] },
    document,
    ApplePaySession: applePay ? { canMakePayments: () => true } : undefined,
  };
  const context = createContext({
    window,
    document,
    navigator: window.navigator,
    history: window.history,
    URL,
    Intl,
  });
  runInContext(source, context);
  const host = miniNode("div");
  (window as { HarmonizerWidget?: { render: (host: MiniNode, data: unknown, opts: unknown) => void } }).HarmonizerWidget?.render(
    host,
    data,
    { preview: true },
  );
  return host;
}

const METHOD_DATA = {
  id: "w1",
  locale: "ru",
  available: true,
  methods: ["ru", "int"],
  defaultMethod: "ru",
  paymentMode: "choice",
  kind: "one_time",
  prices: {
    ru: { amount: 3000, currency: "RUB" },
    int: { amount: 30, currency: "EUR" },
  },
  texts: { methodRu: "Российская карта", methodInt: "Международная карта" },
  elements: [{ type: "method", visible: true }],
  style: {},
};

describe("widget payment method rows", () => {
  it("lists the Russian card, the international card and PayPal when Apple Pay is unavailable", () => {
    const host = renderMethods(METHOD_DATA, false);
    expect(methodLabels(host)).toEqual(["Российская карта", "Международная карта", "PayPal"]);
  });

  it("puts Apple Pay after the international card and before PayPal", () => {
    const host = renderMethods(METHOD_DATA, true);
    expect(methodLabels(host)).toEqual(["Российская карта", "Международная карта", "Apple Pay", "PayPal"]);
  });

  it("hides Apple Pay for a subscription", () => {
    const host = renderMethods({ ...METHOD_DATA, kind: "subscription" }, true);
    expect(methodLabels(host)).toEqual(["Российская карта", "Международная карта", "PayPal"]);
  });

  it("renders the pay button with class pay before it is pressed", () => {
    const host = renderMethods(
      {
        ...METHOD_DATA,
        texts: { ...METHOD_DATA.texts, button: "Оплатить" },
        elements: [...METHOD_DATA.elements, { type: "button", visible: true }],
      },
      false,
    );
    expect(buttonClasses(host)).toEqual(["pay"]);
  });

  it("keeps only the international gateway when the widget is not in choice mode", () => {
    const host = renderMethods(
      { ...METHOD_DATA, paymentMode: "int", defaultMethod: "int" },
      false,
    );
    expect(methodLabels(host)).toEqual(["Международная карта", "PayPal"]);
  });
});

const VPN_HINT = "Страница оплаты не открывается. Если у вас включён VPN, выключите его и нажмите кнопку ещё раз.";

function walkNodes(host: MiniNode, visit: (node: MiniNode) => void) {
  const walk = (node: MiniNode | null) => {
    if (!node) return;
    visit(node);
    node.children.forEach(walk);
    walk(node.shadow);
  };
  walk(host);
}

function findNode(host: MiniNode, pred: (node: MiniNode) => boolean): MiniNode | null {
  let found: MiniNode | null = null;
  walkNodes(host, (node) => {
    if (!found && pred(node)) found = node;
  });
  return found;
}

function pressPay(host: MiniNode) {
  const email = findNode(host, (node) => node.attrs.type === "email");
  const button = findNode(host, (node) => node.tag === "button");
  if (!email || !button) throw new Error("pay form did not render");
  email.value = "sergei@zamkovoi.yoga";
  for (const fn of button.listeners.click ?? []) fn({ preventDefault() {} });
}

function renderCheckout(data: Record<string, unknown>) {
  vi.useFakeTimers();
  const document = {
    currentScript: null,
    readyState: "complete",
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
    createElement: (tag: string) => miniNode(tag),
    createTextNode: (text: string) => {
      const node = miniNode("#text");
      node.textContent = String(text);
      return node;
    },
  };
  const window = {
    history: { state: null, replaceState() {} },
    location: { href: "https://site.ru/landing" },
    navigator: { language: "ru", languages: ["ru"] },
    document,
    addEventListener() {},
  };
  const context = createContext({
    window,
    document,
    navigator: window.navigator,
    history: window.history,
    URL,
    Intl,
    setTimeout,
    clearTimeout,
    fetch: () => new Promise(() => {}),
  });
  runInContext(source, context);
  const host = miniNode("div");
  (window as { HarmonizerWidget?: { render: (host: MiniNode, data: unknown, opts: unknown) => void } }).HarmonizerWidget?.render(
    host,
    data,
    { preview: false, apiBase: "https://api.test" },
  );
  return host;
}

const CHECKOUT_DATA = {
  ...METHOD_DATA,
  texts: {
    ...METHOD_DATA.texts,
    button: "Оплатить",
    errVpn: VPN_HINT,
  },
  elements: [
    { type: "method", visible: true },
    { type: "email", visible: true },
    { type: "button", visible: true },
  ],
};

describe("widget VPN stall hint", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the Russian pay button after 15s and shows errVpn", () => {
    const host = renderCheckout({ ...CHECKOUT_DATA, defaultMethod: "ru" });
    pressPay(host);
    expect(buttonClasses(host)).toEqual(["pay busy"]);
    expect(findNode(host, (node) => node.className === "err")?.textContent).toBe("");

    vi.advanceTimersByTime(15_000);

    expect(buttonClasses(host)).toEqual(["pay"]);
    expect(findNode(host, (node) => node.className === "err")?.textContent).toBe(VPN_HINT);
  });

  it("leaves the international pay button waiting after 15s", () => {
    const host = renderCheckout({ ...CHECKOUT_DATA, defaultMethod: "int" });
    pressPay(host);
    expect(buttonClasses(host)).toEqual(["pay busy"]);
    const error = findNode(host, (node) => node.className === "err");

    vi.advanceTimersByTime(15_000);

    expect(buttonClasses(host)).toEqual(["pay busy"]);
    expect(error?.textContent).toBe("");
    expect(error?.style.display).toBe("none");
  });
});
function miniScriptNode(attrs: Record<string, string>, src: string) {
  const inserted: MiniNode[] = [];
  const script = {
    attrs: { ...attrs },
    src,
    parentNode: {
      inserted,
      insertBefore(host: MiniNode) {
        inserted.push(host);
      },
    },
    getAttribute(name: string) {
      return script.attrs[name] ?? null;
    },
    setAttribute(name: string, value: string) {
      script.attrs[name] = value;
    },
  };
  return script;
}

type FetchCall = { url: string; init?: unknown };

/**
 * Boots widget.js with a real `mount()` over a mock <script> so tests can
 * drive the config-load path (data-api base → Supabase fallback → Vercel).
 */
function bootMountPage(opts: {
  scriptAttrs: Record<string, string>;
  scriptSrc: string;
  fetchImpl: (url: string, init?: unknown) => Promise<unknown>;
}) {
  const document = {
    currentScript: null as unknown,
    readyState: "complete",
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
    createElement: (tag: string) => miniNode(tag),
    createTextNode: (text: string) => {
      const node = miniNode("#text");
      node.textContent = String(text);
      return node;
    },
  };
  const window = {
    history: { state: null, replaceState() {} },
    location: { href: "https://site.ru/consult/" },
    navigator: { language: "ru", languages: ["ru"] },
    document,
  };
  const calls: FetchCall[] = [];
  const fetch = (url: string, init?: unknown) => {
    calls.push({ url, init });
    return opts.fetchImpl(url, init);
  };
  const script = miniScriptNode(opts.scriptAttrs, opts.scriptSrc);
  document.currentScript = script;
  const context = createContext({
    window,
    document,
    navigator: window.navigator,
    history: window.history,
    URL,
    Intl,
    setTimeout,
    clearTimeout,
    fetch,
  });
  runInContext(source, context);
  const host = script.parentNode.inserted[0] ?? null;
  return { window, calls, host, script };
}

async function flushMicrotasks(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

const WIDGET_CONFIG = {
  id: "w1",
  locale: "ru",
  available: true,
  methods: ["int"],
  defaultMethod: "int",
  paymentMode: "choice",
  kind: "one_time",
  prices: { int: { amount: 30, currency: "EUR" } },
  texts: { methodInt: "Международная карта", button: "Оплатить" },
  elements: [
    { type: "method", visible: true },
    { type: "email", visible: true },
    { type: "button", visible: true },
  ],
  style: {},
};

describe("widget config fallbacks", () => {
  it("tries data-api first and falls back to the next base when it fails", async () => {
    const page = bootMountPage({
      scriptAttrs: { "data-id": "w1", "data-lang": "ru", "data-api": "https://primary.test/hz" },
      scriptSrc: "https://site.ru/hz/widget.js",
      fetchImpl: (url) => {
        if (url.startsWith("https://primary.test/")) return Promise.reject(new Error("down"));
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(WIDGET_CONFIG) });
      },
    });
    await flushMicrotasks();

    expect(page.calls.length).toBe(2);
    expect(page.calls[0].url).toContain("https://primary.test/hz/api/widget/w1");
    expect(page.calls[1].url).toContain("/functions/v1/hz-proxy/api/widget/w1");
    expect(page.script.getAttribute("data-hz-mounted")).toBe("1");
    expect(findNode(page.host as MiniNode, (node) => node.tag === "button")).toBeTruthy();
  });

  it("keeps the script origin as the primary base for legacy embeds without data-api", async () => {
    const page = bootMountPage({
      scriptAttrs: { "data-id": "w1", "data-lang": "ru" },
      scriptSrc: "https://api.old/widget.js",
      fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(WIDGET_CONFIG) }),
    });
    await flushMicrotasks();

    expect(page.calls.length).toBe(1);
    expect(page.calls[0].url).toContain("https://api.old/api/widget/w1");
  });

  it("shows a visible localized plate while every base is down and keeps retrying", async () => {
    vi.useFakeTimers();
    try {
      const page = bootMountPage({
        scriptAttrs: { "data-id": "w1", "data-lang": "ru", "data-api": "https://primary.test" },
        scriptSrc: "https://site.ru/hz/widget.js",
        fetchImpl: () => Promise.reject(new Error("all down")),
      });
      await flushMicrotasks();

      expect(page.calls.length).toBe(3);
      const plate = findNode(page.host as MiniNode, (node) => node.className === "hz-loadfail");
      expect(plate?.textContent).toContain("Форма оплаты временно не загрузилась");
      expect(plate?.textContent).toContain("sergei@zamkovoi.yoga");

      vi.advanceTimersByTime(20_000);
      await flushMicrotasks();

      expect(page.calls.length).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });
});

function renderWithBases(
  fetchImpl: (url: string, init?: unknown) => Promise<unknown>,
  apiBases?: string[],
  apiBase?: string,
) {
  const document = {
    currentScript: null,
    readyState: "complete",
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
    createElement: (tag: string) => miniNode(tag),
    createTextNode: (text: string) => {
      const node = miniNode("#text");
      node.textContent = String(text);
      return node;
    },
  };
  const window = {
    history: { state: null, replaceState() {} },
    location: { href: "https://site.ru/landing" },
    navigator: { language: "ru", languages: ["ru"] },
    document,
    addEventListener() {},
  };
  const calls: FetchCall[] = [];
  const fetch = (url: string, init?: unknown) => {
    calls.push({ url, init });
    return fetchImpl(url, init);
  };
  const context = createContext({
    window,
    document,
    navigator: window.navigator,
    history: window.history,
    URL,
    Intl,
    setTimeout,
    clearTimeout,
    fetch,
  });
  runInContext(source, context);
  const host = miniNode("div");
  (window as unknown as { HarmonizerWidget?: { render: (host: MiniNode, data: unknown, opts: unknown) => void } })
    .HarmonizerWidget?.render(host, CHECKOUT_DATA, { preview: false, apiBases, apiBase });
  return { window, host, calls };
}

describe("widget checkout fallbacks", () => {
  it("moves invoice creation to the next base when the first drops the request", async () => {
    const page = renderWithBases(
      (url) => {
        if (url.startsWith("https://a.test/")) return Promise.reject(new Error("down"));
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ paymentUrl: "https://pay.example/form" }) });
      },
      ["https://a.test", "https://b.test"],
    );
    pressPay(page.host);
    await flushMicrotasks();

    expect(page.window.location.href).toBe("https://pay.example/form");
    expect(page.calls.length).toBe(2);
    expect(page.calls[0].url).toContain("https://a.test/api/widget/w1/checkout");
    expect(page.calls[1].url).toContain("https://b.test/api/widget/w1/checkout");
  });

  it("retries a 5xx checkout response on the next base", async () => {
    const page = renderWithBases(
      (url) => {
        if (url.startsWith("https://a.test/")) return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({}) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ paymentUrl: "https://pay.example/ok" }) });
      },
      ["https://a.test", "https://b.test"],
    );
    pressPay(page.host);
    await flushMicrotasks();

    expect(page.window.location.href).toBe("https://pay.example/ok");
    expect(page.calls.length).toBe(2);
  });

  it("still posts to a lone apiBase when no list is given (legacy render calls)", async () => {
    const page = renderWithBases(
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ paymentUrl: "https://pay.example/legacy" }) }),
      undefined,
      "https://api.test",
    );
    pressPay(page.host);
    await flushMicrotasks();

    expect(page.window.location.href).toBe("https://pay.example/legacy");
    expect(page.calls.length).toBe(1);
    expect(page.calls[0].url).toContain("https://api.test/api/widget/w1/checkout");
  });
});
