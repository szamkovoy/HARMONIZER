import Link from "next/link";

import { DashboardMetrics } from "./_components/DashboardMetrics";

const SECTIONS = [
  { href: "/admin/stories", title: "Сторис", hint: "Фото и видео на 24 часа — как в Instagram", stage: "Готово" },
  { href: "/admin/posts", title: "Публикации", hint: "Статьи и анонсы с комментариями", stage: "Готово" },
  { href: "/admin/webinars", title: "Вебинары", hint: "Анонсы, вопросы, записавшиеся, записи", stage: "Готово" },
  { href: "/admin/notifications", title: "Уведомления", hint: "Рассылки сегментам и история", stage: "Готово" },
  { href: "/admin/feedback", title: "Поддержка", hint: "Входящие сообщения пользователей", stage: "Готово" },
  { href: "/admin/users", title: "Пользователи", hint: "Карточки, тарифы, ручные гранты", stage: "Готово" },
  { href: "/admin/prompts", title: "Промпты", hint: "Версии, активация, playground", stage: "Готово" },
];

export default function AdminHomePage() {
  return (
    <div>
      <h1 className="mb-4 text-xl font-bold text-zinc-100">Дашборд</h1>
      <DashboardMetrics />
      <h2 className="mb-3 text-sm font-bold text-zinc-300">Разделы</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4 transition-colors hover:border-emerald-400/30"
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold text-zinc-100">{s.title}</span>
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-zinc-500">{s.stage}</span>
            </div>
            <p className="text-xs text-zinc-500">{s.hint}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
