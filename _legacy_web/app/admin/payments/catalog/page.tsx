"use client";

import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { adminFetch } from "../../_lib/adminApi";
import { LocaleTabs, translateFieldsFromRu } from "../_components/LocaleTabs";
import { WIDGET_LOCALES, type WidgetLocale } from "../../../../lib/paymentWidget/copy";

type LavaOfferSummary = {
  offerId: string;
  offerName: string;
  productId: string;
  productTitle: string;
  prices: { currency: string; amount: number; periodicity: string }[];
};

type CatalogItem = {
  id: string;
  provider: string;
  tier: string;
  currency: string;
  amount: number;
  title: string;
  description: string | null;
  product_kind: string;
  active: boolean;
  updated_at: string;
  lava_offer_id: string | null;
  webinar_credits: number | null;
  webinar_window_days: number | null;
  letter_subject_i18n: Record<string, string>;
  letter_body_i18n: Record<string, string>;
  lava: LavaOfferSummary | null;
};

const TIER_LABELS: Record<string, string> = {
  oracle: "Наставник",
  master: "Мастер",
  webinar: "Вебинар",
  webinar_pack: "Четыре вебинара",
  book: "Книга",
};

const KIND_LABELS: Record<string, string> = {
  subscription: "подписка (30 дней)",
  one_time: "разовая покупка",
};

const WEBINAR_TIERS = new Set(["webinar", "webinar_pack"]);

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function lavaPrices(lava: LavaOfferSummary | null, kind: string): string {
  if (!lava) return "";
  const periodicity = kind === "subscription" ? "MONTHLY" : "ONE_TIME";
  const list = lava.prices.filter((p) => p.periodicity === periodicity && p.currency !== "RUB");
  return list.map((p) => money(p.amount, p.currency)).join(" · ");
}

export default function AdminPaymentCatalogPage() {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [lavaError, setLavaError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch<{ items: CatalogItem[]; lavaError: string | null }>(
        "/api/admin/payment-catalog",
      );
      setItems(res.items);
      setLavaError(res.lavaError);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить каталог");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const editing = items?.find((i) => i.id === editingId) ?? null;

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/admin/payments"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-800"
      >
        <ArrowLeft size={15} /> Платежи
      </Link>
      <h1 className="text-xl font-bold text-zinc-900">Каталог продуктов</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Продукт — это SKU ЮKassa (рубли) и привязанный к нему оффер Lava.top (евро и доллары).
        Цены Lava меняются в кабинете Lava, здесь они только показаны.
      </p>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      {lavaError ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Lava.top не ответила, цены Lava не показаны: {lavaError}
        </p>
      ) : null}
      {items === null && !error ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}

      {editing ? (
        <CatalogEditor
          key={editing.id}
          item={editing}
          onClose={() => setEditingId(null)}
          onSaved={(next) => {
            setItems((prev) => prev?.map((i) => (i.id === next.id ? next : i)) ?? prev);
            setEditingId(null);
          }}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items?.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setEditingId(item.id)}
              className="rounded-xl border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-emerald-400"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-zinc-700">
                  {TIER_LABELS[item.tier] ?? item.tier}
                </span>
                <span>{KIND_LABELS[item.product_kind] ?? item.product_kind}</span>
                {!item.active ? <span className="text-amber-600">выключен</span> : null}
              </div>
              <h2 className="text-base font-semibold text-zinc-900">{item.title}</h2>
              <dl className="mt-2 space-y-0.5 text-sm">
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-zinc-500">ЮKassa</dt>
                  <dd className="font-medium text-zinc-900">{money(item.amount, item.currency)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-zinc-500">Lava.top</dt>
                  <dd className="font-medium text-zinc-900">
                    {item.lava ? lavaPrices(item.lava, item.product_kind) || "нет цены" : item.lava_offer_id ? "оффер не найден" : "не привязан"}
                  </dd>
                </div>
                {WEBINAR_TIERS.has(item.tier) && item.webinar_credits ? (
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-zinc-500">Доступ</dt>
                    <dd className="text-zinc-700">
                      {item.webinar_credits} вебин. за {item.webinar_window_days} дн.
                    </dd>
                  </div>
                ) : null}
              </dl>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CatalogEditor(props: {
  item: CatalogItem;
  onClose: () => void;
  onSaved: (item: CatalogItem) => void;
}) {
  const { item } = props;
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [amount, setAmount] = useState(String(item.amount));
  const [offer, setOffer] = useState<LavaOfferSummary | null>(item.lava);
  const [offerId, setOfferId] = useState<string | null>(item.lava_offer_id);
  const [credits, setCredits] = useState(item.webinar_credits ? String(item.webinar_credits) : "");
  const [days, setDays] = useState(item.webinar_window_days ? String(item.webinar_window_days) : "");
  const [subjects, setSubjects] = useState<Record<string, string>>(item.letter_subject_i18n ?? {});
  const [bodies, setBodies] = useState<Record<string, string>>(item.letter_body_i18n ?? {});
  const [locale, setLocale] = useState<WidgetLocale>("ru");
  const [picking, setPicking] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWebinar = WEBINAR_TIERS.has(item.tier);

  async function translate() {
    const subject = (subjects.ru ?? "").trim();
    const body = (bodies.ru ?? "").trim();
    if (!subject && !body) {
      setError("Сначала напишите письмо на русском");
      return;
    }
    setTranslating(true);
    setError(null);
    try {
      const out = await translateFieldsFromRu({ ...(subject ? { subject } : {}), ...(body ? { body } : {}) });
      const nextSubjects = { ...subjects };
      const nextBodies = { ...bodies };
      for (const loc of WIDGET_LOCALES) {
        const tr = out[loc];
        if (!tr) continue;
        if (tr.subject) nextSubjects[loc] = tr.subject;
        if (tr.body) nextBodies[loc] = tr.body;
      }
      setSubjects(nextSubjects);
      setBodies(nextBodies);
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
      const value = Number(String(amount).replace(",", "."));
      if (!Number.isFinite(value) || value <= 0) throw new Error("Стоимость должна быть положительным числом");
      const payload: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || null,
        amount: value,
        lava_offer_id: offerId,
        letter_subject_i18n: subjects,
        letter_body_i18n: bodies,
      };
      if (isWebinar) {
        payload.webinar_credits = credits.trim() ? Number(credits) : null;
        payload.webinar_window_days = days.trim() ? Number(days) : null;
      }
      const { item: saved } = await adminFetch<{ item: CatalogItem }>(`/api/admin/payment-catalog/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      props.onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  const input = "mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900";

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-zinc-500">
            {TIER_LABELS[item.tier] ?? item.tier} · {KIND_LABELS[item.product_kind] ?? item.product_kind}
          </p>
          <h2 className="text-lg font-semibold text-zinc-900">{item.title}</h2>
        </div>
        <button type="button" onClick={props.onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100">
          <X size={18} />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs text-zinc-500 sm:col-span-2">
          Название (уходит в платёж ЮKassa)
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={128} className={input} />
        </label>
        <label className="block text-xs text-zinc-500 sm:col-span-2">
          Описание в ЮKassa
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={128}
            rows={2}
            className={input}
          />
          <span className="mt-0.5 block text-[11px] text-zinc-400">{description.length}/128</span>
        </label>
        <label className="block text-xs text-zinc-500">
          Цена ЮKassa ({item.currency})
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={input} />
        </label>
        <div className="text-xs text-zinc-500">
          Продукт Lava.top
          <div className="mt-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm">
            {offer ? (
              <>
                <p className="font-medium text-zinc-900">{offer.productTitle}</p>
                <p className="text-zinc-500">
                  {offer.offerName} · {lavaPrices(offer, item.product_kind) || "нет цены"}
                </p>
              </>
            ) : offerId ? (
              <p className="text-amber-700">Оффер {offerId} не найден в Lava</p>
            ) : (
              <p className="text-zinc-400">не привязан</p>
            )}
            <div className="mt-1.5 flex gap-3">
              <button type="button" onClick={() => setPicking(true)} className="text-emerald-700 hover:underline">
                {offerId ? "Сменить" : "Выбрать"}
              </button>
              {offerId ? (
                <button
                  type="button"
                  onClick={() => {
                    setOffer(null);
                    setOfferId(null);
                  }}
                  className="text-zinc-500 hover:underline"
                >
                  Отвязать
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {isWebinar ? (
          <>
            <label className="block text-xs text-zinc-500">
              Сколько вебинаров даёт покупка
              <input value={credits} onChange={(e) => setCredits(e.target.value)} inputMode="numeric" className={input} />
            </label>
            <label className="block text-xs text-zinc-500">
              В течение скольких дней после оплаты
              <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className={input} />
            </label>
            <p className="text-[11px] text-zinc-400 sm:col-span-2">
              Покупатель с виджета автоматически записывается на опубликованные вебинары, которые начинаются
              в течение этого срока после момента оплаты, но не больше указанного числа. Покупка в кабинете
              по-прежнему записывает на конкретный вебинар.
            </p>
          </>
        ) : null}
      </div>

      <div className="mt-6 border-t border-zinc-100 pt-4">
        <h3 className="text-sm font-semibold text-zinc-900">Письмо покупателю с виджета</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Уходит сразу после оплаты на языке, на котором был показан виджет (если перевода нет — на русском).
          {" {{name}}"} — имя из формы. Пустая строка — новый абзац, ссылки становятся кликабельными.
        </p>
        <LocaleTabs
          value={locale}
          onChange={setLocale}
          filled={(loc) => Boolean((subjects[loc] ?? "").trim() && (bodies[loc] ?? "").trim())}
          onTranslate={() => void translate()}
          translating={translating}
        />
        <label className="mt-3 block text-xs text-zinc-500">
          Тема ({locale.toUpperCase()})
          <input
            value={subjects[locale] ?? ""}
            onChange={(e) => setSubjects({ ...subjects, [locale]: e.target.value })}
            maxLength={200}
            className={input}
          />
        </label>
        <label className="mt-3 block text-xs text-zinc-500">
          Текст ({locale.toUpperCase()})
          <textarea
            value={bodies[locale] ?? ""}
            onChange={(e) => setBodies({ ...bodies, [locale]: e.target.value })}
            rows={10}
            className={input}
          />
        </label>
      </div>

      {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={props.onClose}
          className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100"
        >
          Отмена
        </button>
      </div>

      {picking ? (
        <LavaOfferPicker
          currentId={offerId}
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            setOffer(picked);
            setOfferId(picked.offerId);
            setPicking(false);
          }}
        />
      ) : null}
    </section>
  );
}

function LavaOfferPicker(props: {
  currentId: string | null;
  onClose: () => void;
  onPick: (offer: LavaOfferSummary) => void;
}) {
  const [offers, setOffers] = useState<LavaOfferSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (fresh: boolean) => {
    setOffers(null);
    setError(null);
    try {
      const res = await adminFetch<{ offers: LavaOfferSummary[] }>(`/api/admin/lava-offers${fresh ? "?fresh=1" : ""}`);
      setOffers(res.offers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить продукты Lava");
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!offers) return [];
    if (!q) return offers;
    return offers.filter((o) =>
      [o.productTitle, o.offerName, o.offerId, o.productId].some((s) => s.toLowerCase().includes(q)),
    );
  }, [offers, query]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={props.onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-2xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по названию или id"
              className="w-full rounded-lg border border-zinc-200 py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <button
            type="button"
            title="Обновить из Lava"
            onClick={() => void load(true)}
            className="rounded-lg border border-zinc-200 p-2 text-zinc-500 hover:bg-zinc-100"
          >
            <RefreshCw size={15} />
          </button>
          <button type="button" onClick={props.onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100">
            <X size={16} />
          </button>
        </div>
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        {offers === null && !error ? (
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 size={16} className="animate-spin" /> Загружаю продукты Lava…
          </p>
        ) : null}
        <div className="admin-scroll -mx-1 flex-1 overflow-y-auto px-1">
          {filtered.map((o) => (
            <button
              key={o.offerId}
              type="button"
              onClick={() => props.onPick(o)}
              className={`mb-1.5 block w-full rounded-lg border px-3 py-2 text-left text-sm hover:border-emerald-400 ${
                o.offerId === props.currentId ? "border-emerald-500 bg-emerald-50" : "border-zinc-200"
              }`}
            >
              <p className="font-medium text-zinc-900">{o.productTitle}</p>
              <p className="text-xs text-zinc-500">
                {o.offerName} ·{" "}
                {o.prices.map((p) => `${money(p.amount, p.currency)}${p.periodicity === "MONTHLY" ? "/мес" : ""}`).join(" · ")}
              </p>
              <p className="text-[11px] text-zinc-400">{o.productId}</p>
            </button>
          ))}
          {offers && !filtered.length ? <p className="text-sm text-zinc-500">Ничего не найдено</p> : null}
        </div>
      </div>
    </div>
  );
}
