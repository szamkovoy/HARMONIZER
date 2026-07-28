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
 * Compact KPI row for campaign / automation step detail (no % hints).
 * Labels aligned with /admin/email/deliverability.
 */
export function EmailDeliveryStats({ counts, showUnsubscribed }: Props) {
  const showUnsub =
    showUnsubscribed ?? counts.unsubscribed_count !== undefined;

  const cards: Array<[string, number]> = [
    ["Отправлено", counts.sent_count],
    ["Доставлено", counts.delivered_count],
    ["Открыто", counts.opened_count],
    ["Клики", counts.clicked_count],
    ["Недоставлено", counts.bounced_count],
    ["Спам", counts.complained_count],
  ];
  if (showUnsub) {
    cards.push(["Отписались", counts.unsubscribed_count ?? 0]);
  }

  const cols =
    cards.length <= 6
      ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
      : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7";

  return (
    <div className={`grid gap-2 ${cols}`}>
      {cards.map(([label, value]) => (
        <div
          key={label}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-3"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            {label}
          </div>
          <div className="mt-1 text-2xl font-bold text-zinc-900">{value}</div>
        </div>
      ))}
    </div>
  );
}

/** Whether to show the stats grid (any send activity). */
export function hasDeliveryActivity(counts: DeliveryStatCounts): boolean {
  return counts.sent_count > 0;
}
