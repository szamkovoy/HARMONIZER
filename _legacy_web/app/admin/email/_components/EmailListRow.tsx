import type { ReactNode } from "react";

import { AdminListCard } from "../../_components/AdminListCard";

export type EmailListStats = {
  sent_count: number;
  delivered_count: number;
  opened_count: number;
  clicked_count: number;
  bounced_count: number;
  complained_count?: number;
  unsubscribed_count?: number;
  failed_count?: number;
  error_count?: number;
};

function formatCompactStats(stats: EmailListStats): string {
  const parts = [
    `отпр. ${stats.sent_count}`,
    `дост. ${stats.delivered_count}`,
    `откр. ${stats.opened_count}`,
    `клики ${stats.clicked_count}`,
    `отказ ${stats.bounced_count}`,
  ];
  if ((stats.complained_count ?? 0) > 0) parts.push(`спам ${stats.complained_count}`);
  if ((stats.unsubscribed_count ?? 0) > 0) parts.push(`отпис. ${stats.unsubscribed_count}`);
  const errors = stats.error_count ?? stats.failed_count ?? 0;
  if (errors > 0) parts.push(`ошиб. ${errors}`);
  return parts.join(" · ");
}

type Props = {
  href: string;
  title: string;
  subtitle: string;
  /** When true, show compact delivery stats; otherwise show `idleLabel`. */
  showStats?: boolean;
  stats?: EmailListStats;
  idleLabel?: string;
  /** Chain-only controls (reorder, delete, delay). */
  trailingActions?: ReactNode;
  below?: ReactNode;
  onDelete?: () => void;
  deleting?: boolean;
};

/**
 * Campaign / automation-step list card — same chrome as Videos / Stories.
 */
export function EmailListRow({
  href,
  title,
  subtitle,
  showStats = false,
  stats,
  idleLabel = "черновик",
  trailingActions,
  below,
  onDelete,
  deleting,
}: Props) {
  const meta = showStats && stats ? formatCompactStats(stats) : idleLabel;
  return (
    <li className="list-none">
      <AdminListCard
        href={href}
        title={title}
        subtitle={subtitle}
        meta={meta}
        trailing={trailingActions}
        onDelete={onDelete}
        deleting={deleting}
      />
      {below ? (
        <div className="mt-1 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2">{below}</div>
      ) : null}
    </li>
  );
}
