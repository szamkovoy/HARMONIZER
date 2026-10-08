"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, Eye, EyeOff, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { adminFetch } from "../../../_lib/adminApi";
import { LocaleTabs, translateFieldsFromRu } from "../../_components/LocaleTabs";
import {
  DEFAULT_WIDGET_STYLE,
  WIDGET_FONT_OPTIONS,
  normalizeWidgetConfig,
  resolveWidgetLocale,
  resolveWidgetTexts,
  widgetEmbedCode,
  type WidgetConfig,
  type WidgetElementType,
  type WidgetMethod,
  type WidgetStyle,
} from "../../../../../lib/paymentWidget/config";
import {
  WIDGET_EDITABLE_KEYS,
  WIDGET_LOCALES,
  getWidgetEditableDefaults,
  type WidgetEditableTexts,
  type WidgetLocale,
} from "../../../../../lib/paymentWidget/copy";

type CatalogItem = {
  id: string;
  tier: string;
  title: string;
  amount: number;
  currency: string;
  product_kind: string;
  active: boolean;
  lava: { prices: { currency: string; amount: number; periodicity: string }[] } | null;
};

type WidgetItem = {
  id: string;
  title: string;
  catalog_id: string | null;
  active: boolean;
  config: WidgetConfig;
};

declare global {
  interface Window {
    HarmonizerWidget?: {
      render: (host: HTMLElement, data: unknown, opts?: { preview?: boolean; thanks?: boolean }) => void;
    };
  }
}

const ELEMENT_LABELS: Record<WidgetElementType, string> = {
  title: "Заголовок",
  text: "Текст",
  method: "Платёжная система",
  price: "Цена",
  name: "Имя",
  email: "Email",
  button: "Кнопка «Оплатить»",
  footer: "Текст под кнопкой",
};

const ELEMENT_FIELDS: Record<WidgetElementType, (keyof WidgetEditableTexts)[]> = {
  title: ["title"],
  text: ["text"],
  method: ["methodRu", "methodInt"],
  price: ["perMonth"],
  name: ["namePlaceholder"],
  email: ["emailPlaceholder"],
  button: ["button"],
  footer: ["footer"],
};

const FIELD_LABELS: Record<keyof WidgetEditableTexts, string> = {
  title: "Заголовок",
  text: "Текст",
  footer: "Текст под кнопкой",
  namePlaceholder: "Подсказка в поле имени",
  emailPlaceholder: "Подсказка в поле email",
  button: "Надпись на кнопке",
  methodRu: "Российская карта",
  methodInt: "Международная карта",
  perMonth: "Подпись к цене подписки",
  thanksTitle: "Заголовок",
  thanksBody: "Текст",
};

const MULTILINE = new Set<keyof WidgetEditableTexts>(["text", "footer", "thanksBody"]);

const LOCALE_NAMES: Record<WidgetLocale, string> = {
  ru: "русский",
  en: "английский",
  de: "немецкий",
  fr: "французский",
  it: "итальянский",
  es: "испанский",
  pt: "португальский",
  nl: "нидерландский",
};

const inputCls = "mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900";

function lavaPreviewPrice(item: CatalogItem | undefined): { amount: number; currency: string } | null {
  if (!item?.lava) return null;
  const periodicity = item.product_kind === "subscription" ? "MONTHLY" : "ONE_TIME";
  const price =
    item.lava.prices.find((p) => p.currency === "EUR" && p.periodicity === periodicity) ??
    item.lava.prices.find((p) => p.currency === "USD" && p.periodicity === periodicity);
  return price ? { amount: price.amount, currency: price.currency } : null;
}

export default function AdminPaymentWidgetEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [widget, setWidget] = useState<WidgetItem | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [config, setConfig] = useState<WidgetConfig>(() => normalizeWidgetConfig({}));
  const [locale, setLocale] = useState<WidgetLocale>("ru");
  const [selected, setSelected] = useState<WidgetElementType | "thanks" | "style" | null>("title");
  const [previewMethod, setPreviewMethod] = useState<WidgetMethod>("ru");
  const [previewThanks, setPreviewThanks] = useState(false);
  const [embedLang, setEmbedLang] = useState("ru");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [w, c] = await Promise.all([
          adminFetch<{ item: WidgetItem }>(`/api/admin/payment-widgets/${id}`),
          adminFetch<{ items: CatalogItem[] }>("/api/admin/payment-catalog"),
        ]);
        setWidget(w.item);
        setTitle(w.item.title);
        setCatalogId(w.item.catalog_id);
        setActive(w.item.active);
        setConfig(normalizeWidgetConfig(w.item.config));
        setCatalog(c.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить виджет");
      }
    })();
  }, [id]);

  const product = catalog.find((c) => c.id === catalogId);

  const setText = useCallback((loc: WidgetLocale, key: keyof WidgetEditableTexts, value: string) => {
    setConfig((prev) => ({
      ...prev,
      texts: { ...prev.texts, [loc]: { ...(prev.texts[loc] ?? {}), [key]: value } },
    }));
  }, []);

  const setStyle = useCallback(<K extends keyof WidgetStyle>(key: K, value: WidgetStyle[K]) => {
    setConfig((prev) => ({ ...prev, style: { ...prev.style, [key]: value } }));
  }, []);

  function moveElement(index: number, delta: number) {
    setConfig((prev) => {
      const next = [...prev.elements];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, elements: next };
    });
  }

  function toggleElement(index: number) {
    setConfig((prev) => ({
      ...prev,
      elements: prev.elements.map((e, i) => (i === index ? { ...e, visible: !e.visible } : e)),
    }));
  }

  async function translate() {
    const ru = config.texts.ru ?? {};
    const fields: Record<string, string> = {};
    for (const key of WIDGET_EDITABLE_KEYS) {
      const v = (ru[key] ?? "").trim();
      if (v) fields[key] = v;
    }
    if (!Object.keys(fields).length) {
      setError("На русском пока нет своих текстов — переводить нечего (стандартные надписи уже переведены).");
      return;
    }
    setTranslating(true);
    setError(null);
    try {
      const out = await translateFieldsFromRu(fields);
      setConfig((prev) => {
        const texts = { ...prev.texts };
        for (const loc of WIDGET_LOCALES) {
          const tr = out[loc];
          if (!tr || loc === "ru") continue;
          texts[loc] = { ...(texts[loc] ?? {}), ...tr };
        }
        return { ...prev, texts };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось перевести");
    } finally {
      setTranslating(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { item } = await adminFetch<{ item: WidgetItem }>(`/api/admin/payment-widgets/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, catalog_id: catalogId, active, config }),
      });
      setWidget(item);
      setConfig(normalizeWidgetConfig(item.config));
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  const previewData = useMemo(() => {
    const ru = product && product.currency === "RUB" ? { amount: product.amount, currency: "RUB" } : null;
    const int = lavaPreviewPrice(product);
    const all: WidgetMethod[] = [];
    if (ru && config.paymentMode !== "int") all.push("ru");
    if (int && config.paymentMode !== "ru") all.push("int");
    return {
      id,
      locale,
      available: true,
      texts: resolveWidgetTexts(config, locale),
      paymentMode: config.paymentMode,
      requireName: config.requireName,
      elements: config.elements,
      style: config.style,
      kind: product?.product_kind ?? "one_time",
      prices: { ru, int },
      methods: all,
      defaultMethod: all.includes(previewMethod) ? previewMethod : (all[0] ?? null),
    };
  }, [config, id, locale, previewMethod, product]);

  const fallsBack = resolveWidgetLocale(config, locale) !== locale;

  const localeFilled = (loc: WidgetLocale) => {
    const entry = config.texts[loc] ?? {};
    return WIDGET_EDITABLE_KEYS.some((k) => (entry[k] ?? "").trim());
  };

  if (error && !widget) return <p className="text-sm text-red-500">{error}</p>;
  if (!widget) {
    return (
      <p className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Загружаю…
      </p>
    );
  }

  const textField = (key: keyof WidgetEditableTexts) => {
    const value = config.texts[locale]?.[key] ?? "";
    const placeholder = getWidgetEditableDefaults(locale)[key] || "не показывается, пока пусто";
    return (
      <label key={key} className="block text-xs text-zinc-500">
        {FIELD_LABELS[key]} ({locale.toUpperCase()})
        {MULTILINE.has(key) ? (
          <textarea
            value={value}
            placeholder={placeholder}
            onChange={(e) => setText(locale, key, e.target.value)}
            rows={4}
            className={inputCls}
          />
        ) : (
          <input
            value={value}
            placeholder={placeholder}
            onChange={(e) => setText(locale, key, e.target.value)}
            className={inputCls}
          />
        )}
      </label>
    );
  };

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/admin/payments/widgets"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-800"
      >
        <ArrowLeft size={15} /> Виджеты
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
            <label className="block text-xs text-zinc-500">
              Название виджета (только для админки)
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            </label>
            <label className="block text-xs text-zinc-500">
              Продукт из каталога
              <select
                value={catalogId ?? ""}
                onChange={(e) => setCatalogId(e.target.value || null)}
                className={inputCls}
              >
                <option value="">— не выбран —</option>
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · {c.amount} {c.currency}
                    {!c.active ? " (выключен)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-zinc-500">
              Страница «Спасибо» после оплаты (необязательно)
              <input
                value={config.successUrl ?? ""}
                onChange={(e) => setConfig({ ...config, successUrl: e.target.value || null })}
                placeholder="https://…"
                className={inputCls}
              />
              <span className="mt-1 block text-[11px] text-zinc-400">
                Если не указана: после международной карты остаётся страница Lava, после российской
                покупатель возвращается на лендинг и видит благодарность в самом виджете.
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Виджет включён
            </label>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-zinc-900">Элементы формы</h2>
            <p className="mb-3 text-xs text-zinc-500">Нажмите на элемент, чтобы изменить его. Стрелки меняют порядок.</p>
            <div className="flex flex-col gap-1">
              {config.elements.map((el, index) => {
                const locked = el.type === "email" || el.type === "button";
                const on = selected === el.type;
                return (
                  <div
                    key={el.type}
                    className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 ${
                      on ? "border-emerald-500 bg-emerald-50" : "border-zinc-200"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(el.type)}
                      className={`flex-1 text-left text-sm ${el.visible ? "text-zinc-900" : "text-zinc-400 line-through"}`}
                    >
                      {ELEMENT_LABELS[el.type]}
                    </button>
                    <button
                      type="button"
                      title={locked ? "Обязательный элемент" : el.visible ? "Скрыть" : "Показать"}
                      disabled={locked}
                      onClick={() => toggleElement(index)}
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-100 disabled:opacity-30"
                    >
                      {el.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => moveElement(index, -1)}
                      disabled={index === 0}
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-100 disabled:opacity-30"
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveElement(index, 1)}
                      disabled={index === config.elements.length - 1}
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-100 disabled:opacity-30"
                    >
                      <ArrowDown size={15} />
                    </button>
                  </div>
                );
              })}
              <div className="mt-2 flex gap-1">
                {(["thanks", "style"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSelected(k)}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-sm ${
                      selected === k ? "border-emerald-500 bg-emerald-50 text-zinc-900" : "border-zinc-200 text-zinc-700"
                    }`}
                  >
                    {k === "thanks" ? "Благодарность" : "Оформление"}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {selected && selected !== "style" ? (
            <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-900">
                {selected === "thanks" ? "Благодарность после оплаты" : ELEMENT_LABELS[selected]}
              </h2>
              <LocaleTabs
                value={locale}
                onChange={setLocale}
                filled={localeFilled}
                onTranslate={() => void translate()}
                translating={translating}
              />
              {fallsBack ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Не все тексты переведены на {LOCALE_NAMES[locale]}: посетителям с этим языком будет показан
                  вариант на русском.
                </p>
              ) : null}
              {selected === "method" ? (
                <label className="block text-xs text-zinc-500">
                  Какие карты принимать
                  <select
                    value={config.paymentMode}
                    onChange={(e) => setConfig({ ...config, paymentMode: e.target.value as WidgetConfig["paymentMode"] })}
                    className={inputCls}
                  >
                    <option value="choice">На выбор (российская по IP из России, иначе международная)</option>
                    <option value="ru">Только российская карта (ЮKassa, рубли)</option>
                    <option value="int">Только международная карта (Lava.top, EUR / USD)</option>
                  </select>
                  <span className="mt-1 block text-[11px] text-zinc-400">
                    Если способ один, переключатель не показывается.
                  </span>
                </label>
              ) : null}
              {selected === "name" ? (
                <label className="flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="checkbox"
                    checked={config.requireName}
                    onChange={(e) => setConfig({ ...config, requireName: e.target.checked })}
                  />
                  Имя обязательно
                </label>
              ) : null}
              {(selected === "thanks" ? (["thanksTitle", "thanksBody"] as const) : ELEMENT_FIELDS[selected]).map(
                (key) => textField(key),
              )}
            </section>
          ) : null}

          {selected === "style" ? <StyleEditor style={config.style} setStyle={setStyle} /> : null}

          <section className="space-y-2 rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">Код для вставки на сайт</h2>
            <label className="block text-xs text-zinc-500">
              Язык виджета
              <select value={embedLang} onChange={(e) => setEmbedLang(e.target.value)} className={inputCls}>
                <option value="auto">По языку браузера</option>
                {WIDGET_LOCALES.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc.toUpperCase()} — {LOCALE_NAMES[loc]}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <code className="block flex-1 break-all rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-800">
                {widgetEmbedCode(widget.id, embedLang)}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(widgetEmbedCode(widget.id, embedLang));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="self-start rounded-lg border border-zinc-200 p-2 text-zinc-500 hover:bg-zinc-100"
                title="Скопировать"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <p className="text-[11px] text-zinc-400">
              В WordPress — блок «HTML». Если перевода на язык браузера нет, показывается русский вариант.
              Письмо покупателю уходит на языке, на котором был показан виджет. На одной странице можно
              вставить несколько виджетов, в том числе один и тот же.
            </p>
          </section>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>Предпросмотр:</span>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as WidgetLocale)}
              className="rounded-lg border border-zinc-200 px-2 py-1"
            >
              {WIDGET_LOCALES.map((loc) => (
                <option key={loc} value={loc}>
                  {loc.toUpperCase()}
                </option>
              ))}
            </select>
            <select
              value={previewMethod}
              onChange={(e) => setPreviewMethod(e.target.value as WidgetMethod)}
              className="rounded-lg border border-zinc-200 px-2 py-1"
            >
              <option value="ru">посетитель из России</option>
              <option value="int">посетитель из-за рубежа</option>
            </select>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={previewThanks} onChange={(e) => setPreviewThanks(e.target.checked)} />
              после оплаты
            </label>
          </div>
          <WidgetPreview data={previewData} thanks={previewThanks} />
          {!product ? <p className="mt-2 text-xs text-amber-700">Выберите продукт — без него виджет не принимает оплату.</p> : null}
          {product && !product.lava && config.paymentMode !== "ru" ? (
            <p className="mt-2 text-xs text-amber-700">
              У продукта нет оффера Lava — международная карта не будет показана. Привяжите его в каталоге.
            </p>
          ) : null}
          <p className="mt-2 text-[11px] text-zinc-400">
            Международная цена в предпросмотре — в евро; посетители из США увидят цену в долларах.
          </p>
        </div>
      </div>

      <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t border-zinc-200 bg-white/95 py-3 backdrop-blur">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
        {savedAt ? <span className="text-sm text-emerald-700">Сохранено</span> : null}
        {error ? <span className="text-sm text-red-500">{error}</span> : null}
      </div>
    </div>
  );
}

function WidgetPreview(props: { data: unknown; thanks: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(() => typeof window !== "undefined" && Boolean(window.HarmonizerWidget));

  useEffect(() => {
    if (ready) return;
    const existing = document.querySelector<HTMLScriptElement>("script[data-hz-admin-preview]");
    const script = existing ?? document.createElement("script");
    const onLoad = () => setReady(true);
    script.addEventListener("load", onLoad);
    if (!existing) {
      script.src = "/widget.js";
      script.async = true;
      script.setAttribute("data-hz-admin-preview", "1");
      document.body.appendChild(script);
    }
    return () => script.removeEventListener("load", onLoad);
  }, [ready]);

  useEffect(() => {
    if (!ready || !hostRef.current || !window.HarmonizerWidget) return;
    window.HarmonizerWidget.render(hostRef.current, props.data, { preview: true, thanks: props.thanks });
  }, [ready, props.data, props.thanks]);

  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-[repeating-conic-gradient(#f4f4f5_0%_25%,#ffffff_0%_50%)] bg-[length:16px_16px] p-6">
      <div ref={hostRef} />
      {!ready ? <p className="text-sm text-zinc-500">Загружаю виджет…</p> : null}
    </div>
  );
}

function StyleEditor(props: {
  style: WidgetStyle;
  setStyle: <K extends keyof WidgetStyle>(key: K, value: WidgetStyle[K]) => void;
}) {
  const { style, setStyle } = props;
  const color = (key: "background" | "textColor" | "accentColor" | "buttonTextColor" | "borderColor", label: string) => {
    const value = style[key];
    const transparent = value === "transparent";
    return (
      <div className="text-xs text-zinc-500">
        {label}
        <div className="mt-1 flex items-center gap-2">
          <input
            type="color"
            value={transparent || !value.startsWith("#") ? DEFAULT_WIDGET_STYLE[key] : value}
            disabled={transparent}
            onChange={(e) => setStyle(key, e.target.value)}
            className="h-9 w-12 cursor-pointer rounded border border-zinc-200 disabled:opacity-40"
          />
          <input
            value={value}
            onChange={(e) => setStyle(key, e.target.value)}
            className="w-28 rounded-lg border border-zinc-200 px-2 py-1.5 text-sm text-zinc-900"
          />
          {key === "background" ? (
            <label className="flex items-center gap-1 text-zinc-600">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(e) => setStyle("background", e.target.checked ? "transparent" : DEFAULT_WIDGET_STYLE.background)}
              />
              прозрачный
            </label>
          ) : null}
        </div>
      </div>
    );
  };
  const num = (
    key: "borderWidth" | "radius" | "paddingTop" | "paddingBottom" | "paddingX" | "maxWidth" | "fontSize" | "titleSize" | "controlRadius",
    label: string,
  ) => (
    <label className="block text-xs text-zinc-500">
      {label}
      <input
        type="number"
        value={style[key]}
        onChange={(e) => setStyle(key, Number(e.target.value))}
        className={inputCls}
      />
    </label>
  );

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">Оформление</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {color("background", "Фон")}
        {color("textColor", "Цвет текста")}
        {color("accentColor", "Цвет кнопки и выделения")}
        {color("buttonTextColor", "Цвет надписи на кнопке")}
        {color("borderColor", "Цвет рамки")}
        {num("borderWidth", "Толщина рамки, px (0 — без рамки)")}
        {num("radius", "Скругление углов, px")}
        {num("controlRadius", "Скругление полей и кнопки, px")}
        {num("paddingTop", "Отступ сверху, px")}
        {num("paddingBottom", "Отступ снизу, px")}
        {num("paddingX", "Отступы по бокам, px")}
        {num("maxWidth", "Максимальная ширина, px")}
        {num("fontSize", "Размер текста, px")}
        {num("titleSize", "Размер заголовка, px")}
        <label className="block text-xs text-zinc-500">
          Шрифт
          <select value={style.fontFamily} onChange={(e) => setStyle("fontFamily", e.target.value)} className={inputCls}>
            {WIDGET_FONT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-zinc-500">
          Выравнивание
          <select
            value={style.align}
            onChange={(e) => setStyle("align", e.target.value as WidgetStyle["align"])}
            className={inputCls}
          >
            <option value="center">по центру</option>
            <option value="left">по левому краю</option>
          </select>
        </label>
      </div>
    </section>
  );
}
