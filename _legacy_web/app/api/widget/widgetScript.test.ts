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
