import Link from "next/link";
import type { ReactNode } from "react";
import { Loader2, Trash2 } from "lucide-react";

/**
 * Canonical admin list row: one card per item (gap stack), not rows inside a
 * single bordered block. Matches Stories / Videos / Webinars.
 *
 * Performance with thousands of rows is dominated by pagination/API, not by
 * card vs table chrome — keep page size modest and infinite-scroll later.
 */
export function AdminListCard({
  href,
  title,
  subtitle,
  meta,
  leading,
  trailing,
  onDelete,
  deleting = false,
  deleteTitle = "Удалить",
}: {
  href?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onDelete?: () => void;
  deleting?: boolean;
  deleteTitle?: string;
}) {
  const body = (
    <>
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-zinc-900">{title}</div>
        {subtitle ? <div className="mt-0.5 text-xs text-zinc-500">{subtitle}</div> : null}
        {meta ? <div className="mt-1 text-[11px] leading-relaxed text-zinc-500">{meta}</div> : null}
      </div>
    </>
  );

  return (
    <div className="flex items-stretch gap-1 rounded-2xl border border-zinc-200 bg-white p-3 transition-colors hover:border-emerald-400/30">
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-90">
          {body}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
      )}
      {trailing ? (
        <div className="flex shrink-0 flex-col items-end justify-center gap-1">{trailing}</div>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          title={deleteTitle}
          disabled={deleting}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          }}
          className="shrink-0 self-center p-2 text-zinc-400 hover:text-rose-500 disabled:opacity-50"
        >
          {deleting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Trash2 size={14} />
          )}
        </button>
      ) : null}
    </div>
  );
}

export const ADMIN_LIST_STACK = "flex flex-col gap-3";
