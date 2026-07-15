"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  BellRing,
  CreditCard,
  CircleUserRound,
  Gauge,
  LifeBuoy,
  LogOut,
  MessagesSquare,
  Newspaper,
  SlidersHorizontal,
  Sparkles,
  Video,
} from "lucide-react";

import { AdminApiError, adminFetch } from "../_lib/adminApi";
import { getBrowserSupabase } from "../_lib/supabaseBrowser";

const NAV_ITEMS = [
  { href: "/admin", label: "Дашборд", icon: Gauge },
  { href: "/admin/stories", label: "Сторис", icon: Sparkles },
  { href: "/admin/posts", label: "Видео", icon: Newspaper },
  { href: "/admin/webinars", label: "Вебинары", icon: Video },
  { href: "/admin/notifications", label: "Уведомления", icon: BellRing },
  { href: "/admin/feedback", label: "Поддержка", icon: LifeBuoy },
  { href: "/admin/users", label: "Пользователи", icon: CircleUserRound },
  { href: "/admin/payments", label: "Платежи", icon: CreditCard },
  { href: "/admin/prompts", label: "Промпты", icon: SlidersHorizontal },
] as const;

/** На мобильном в нижней панели помещается 5 пунктов; остальные — в «Ещё» не делаем, просто скроллим. */
type AuthPhase = "checking" | "admin" | "anonymous";

export function AdminChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [phase, setPhase] = useState<AuthPhase>("checking");
  const [supportBadge, setSupportBadge] = useState(0);
  const isLoginPage = pathname === "/admin/login";

  const verifyAdmin = useCallback(async () => {
    const supabase = getBrowserSupabase();
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setPhase("anonymous");
      return;
    }
    try {
      const me = await adminFetch<{
        userId: string;
        displayName: string | null;
        unprocessedSupportCount?: number;
      }>("/api/admin/me");
      setSupportBadge(me.unprocessedSupportCount ?? 0);
      setPhase("admin");
    } catch (err) {
      // Только явный отказ в доступе — иначе сетевой сбой / terminated при DELETE
      // разлогинивал админа и обрывал сам запрос удаления.
      const status = err instanceof AdminApiError ? err.status : 0;
      if (status === 401 || status === 403) {
        await supabase.auth.signOut();
        setPhase("anonymous");
        return;
      }
      setPhase("admin");
    }
  }, []);

  useEffect(() => {
    void verifyAdmin();
    const { data: sub } = getBrowserSupabase().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setPhase("anonymous");
      if (event === "SIGNED_IN") void verifyAdmin();
    });
    return () => sub.subscription.unsubscribe();
  }, [verifyAdmin]);

  // Refresh badge when leaving/entering support inbox.
  useEffect(() => {
    if (phase !== "admin") return;
    void adminFetch<{ unprocessedSupportCount?: number }>("/api/admin/me")
      .then((me) => setSupportBadge(me.unprocessedSupportCount ?? 0))
      .catch(() => undefined);
  }, [pathname, phase]);

  useEffect(() => {
    if (phase === "anonymous" && !isLoginPage) router.replace("/admin/login");
    if (phase === "admin" && isLoginPage) router.replace("/admin");
  }, [phase, isLoginPage, router]);

  const signOut = useCallback(async () => {
    await getBrowserSupabase().auth.signOut();
    router.replace("/admin/login");
  }, [router]);

  if (isLoginPage) return <>{children}</>;

  if (phase !== "admin") {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-zinc-400">
        Проверяю доступ…
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full min-w-0 max-w-6xl overflow-x-clip">
      {/* Сайдбар — desktop */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-white/10 p-4 md:flex">
        <div className="mb-6 px-2 text-lg font-bold tracking-wide text-emerald-300">
          Harmonizer
          <span className="block text-xs font-normal text-zinc-500">панель управления</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
            const badge = href === "/admin/feedback" && supportBadge > 0 ? supportBadge : 0;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-emerald-400/10 font-semibold text-emerald-300"
                    : "text-zinc-300 hover:bg-white/5"
                }`}
              >
                <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
                <span className="flex-1">{label}</span>
                {badge > 0 ? (
                  <span className="rounded-full bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={signOut}
          className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
        >
          <LogOut size={18} strokeWidth={1.8} />
          Выйти
        </button>
      </aside>

      {/* Контент */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Шапка — mobile */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-[#07080c]/90 px-4 py-3 backdrop-blur md:hidden">
          <span className="text-base font-bold text-emerald-300">Harmonizer · Админ</span>
          <button type="button" onClick={signOut} aria-label="Выйти" className="p-1 text-zinc-400">
            <LogOut size={20} strokeWidth={1.8} />
          </button>
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-5 pb-24 md:px-8 md:pb-8">
          {children}
        </main>

        {/* Нижняя навигация — mobile (горизонтальный скролл, все разделы) */}
        <nav className="fixed inset-x-0 bottom-0 z-20 flex gap-1 overflow-x-auto border-t border-white/10 bg-[#0b0d12]/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur md:hidden">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
            const badge = href === "/admin/feedback" && supportBadge > 0 ? supportBadge : 0;
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex min-w-[64px] flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[10px] ${
                  active ? "text-emerald-300" : "text-zinc-400"
                }`}
              >
                <span className="relative">
                  <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
                  {badge > 0 ? (
                    <span className="absolute -right-2 -top-1 rounded-full bg-emerald-400 px-1 text-[8px] font-bold leading-3 text-emerald-950">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                </span>
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

/** Заглушка раздела до его этапа реализации. */
export function AdminSectionPlaceholder({ title, stage }: { title: string; stage: string }) {
  const Icon = MessagesSquare;
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] px-6 py-16 text-center">
      <Icon size={28} className="text-zinc-500" strokeWidth={1.5} />
      <h1 className="text-lg font-semibold text-zinc-200">{title}</h1>
      <p className="max-w-sm text-sm text-zinc-500">
        Раздел появится на этапе «{stage}» — по плану внедрения админ-панели.
      </p>
    </div>
  );
}
