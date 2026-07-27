import Link from "next/link";
import type { ReactNode } from "react";

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
  /** Chain-only controls (reorder, delete, delay) — rendered below/beside the link row. */
  trailingActions?: ReactNode;
  below?: ReactNode;
};

/**
 * Shared list row for campaigns and automation steps.
 * Click navigates; no separate «Редактировать» button.
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
}: Props) {
  return (
    <li>
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <Link
          href={href}
          className="min-w-0 flex-1 transition-colors hover:opacity-80"
        >
          <div className="truncate font-medium text-zinc-900">{title}</div>
          <div className="mt-0.5 text-xs text-zinc-500">{subtitle}</div>
          <div className="mt-1 text-[11px] leading-relaxed text-zinc-500 sm:hidden">
            {showStats && stats ? formatCompactStats(stats) : idleLabel}
          </div>
        </Link>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <div className="hidden text-[11px] leading-relaxed text-zinc-500 sm:block sm:text-right">
            {showStats && stats ? formatCompactStats(stats) : idleLabel}
          </div>
          {trailingActions ? (
            <div className="flex flex-wrap items-center gap-1">{trailingActions}</div>
          ) : null}
        </div>
      </div>
      {below ? <div className="border-t border-zinc-50 px-4 pb-3 pt-2">{below}</div> : null}
    </li>
  );
}
