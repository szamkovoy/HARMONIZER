---
id: 02_modules/courses/dependencies
title: Courses Dependencies
version: 1.1
updated: 2026-11-18
depends_on: [02_modules/courses/spec]
code_refs: [modules/courses/CoursesProvider.tsx, modules/courses/CourseContent.tsx, _legacy_web/app/api/_utils/courseMailRunner.ts]
---

## 1. Зависит от

- `account_web`: существующие `openAccountCabinet` и feature flag для CTA пустого списка курсов.

- `webinars`: существующие webinar_passes/регистрации, apply_webinar_passes и sendPassWebinarInvites; источник пропуска — обычное прохождение курса.

- `profile`: auth/JWT, `users` и `email_contacts` для адреса, имени, локали и зоны; provider сбрасывает данные при смене пользователя.
- `marketing_email`: транспорт Resend, оболочка/подстановка письма, редактор `email_automation_steps`, история отправок. Связанные email-enrollment исключены из generic runner.
- `practices`: общий `PhoneVimeoPlayer`, Vimeo helpers и существующие practice ID бонусов; каталог и тарифный гейт асан не меняются.
- `remote-play`: `useRemotePlay` и существующие экраны `/connect-tv`, `/tv-remote` для видео урока.
- `i18n`: `useAppLocale`, восемь локалей интерфейса в `modules/courses/strings.ts`; учебный пилот RU.
- `infra`: Supabase/Postgres, RLS, cron/pg_net, Vercel и существующий cron secret, Expo Router, общие UI-токены.
- `admin_panel`: `requireAdmin` для подготовки/старта/очистки теста и существующий редактор писем.

## 2. От него зависят

- `webinars`: проверка активности/пользователя course-enrollment при применении пропусков; отзыв через жизненный цикл курса.

- `profile`: карточка «Мои курсы», история и истёкший доступ.
- `daily_forecast`: независимый учебный блок на «Дне», без изменения DayPlan payload/кэша.
- `subscription`: tab layout допускает курс на free, сохраняя гейт платного планировщика и других функций.
- `marketing_email`: `runEmailAutomations` вызывает отдельный course runner; тип `course` в редакторе.
- `admin_panel`: тестовый API курса, запрет менять тип course-цепочки на generic и пояснение независимого календаря.

## 3. Риски

Привязка к email-шагам должна оставаться стабильной при авторской правке; delay_hours шага не задаёт календарь курса. Смена пользователя не должна показывать предыдущий снимок. Новые продукты с одновременной выдачей нескольких материалов и отдельными вводными письмами требуют решения до импорта.
