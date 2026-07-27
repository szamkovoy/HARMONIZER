export type DeliveryStatCounts = {
  sent_count: number;
  delivered_count: number;
  opened_count: number;
  clicked_count: number;
  bounced_count: number;
  complained_count: number;
  unsubscribed_count?: number;
  error_count?: number;
  failed_count?: number;
};

type Props = {
  counts: DeliveryStatCounts;
  /** Show unsubscribe card (campaigns). Default true if unsubscribed_count provided. */
  showUnsubscribed?: boolean;
};

/**
 * KPI grid shared by campaign detail and automation step detail.
 */
export function EmailDeliveryStats({ counts, showUnsubscribed }: Props) {
  const errors = counts.error_count ?? counts.failed_count ?? 0;
  const showUnsub =
    showUnsubscribed ?? counts.unsubscribed_count !== undefined;

  const cards: Array<[string, number, string]> = [
    ["Отправлено", counts.sent_count, "Сколько писем ушло"],
    ["Доставлено", counts.delivered_count, "Принял почтовый сервер"],
    ["Открыто", counts.opened_count, "Открыли письмо"],
    ["Клики", counts.clicked_count, "Кликнули по ссылке"],
    ["Отказ", counts.bounced_count, "Не удалось доставить"],
    ["Спам", counts.complained_count, "Пометили как спам"],
  ];
  if (showUnsub) {
    cards.push([
      "Отписались",
      counts.unsubscribed_count ?? 0,
      "По ссылке в письме",
    ]);
  }
  cards.push(["Ошибки", errors, "Ошибки при отправке"]);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cards.map(([label, value, hint]) => (
        <div
          key={label}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5"
        >
          <div className="text-lg font-semibold text-zinc-900">{value}</div>
          <div className="text-xs font-medium text-zinc-700">{label}</div>
          <p className="mt-0.5 text-[11px] text-zinc-400">{hint}</p>
        </div>
      ))}
    </div>
  );
}

/** Whether to show the stats grid (any activity). */
export function hasDeliveryActivity(counts: DeliveryStatCounts): boolean {
  return (
    counts.sent_count > 0 ||
    (counts.error_count ?? 0) > 0 ||
    (counts.failed_count ?? 0) > 0
  );
}
