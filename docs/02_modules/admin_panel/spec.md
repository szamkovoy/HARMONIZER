---
id: 02_modules/admin_panel/spec
title: Admin Panel Spec
version: 1.10
updated: 2026-07-22
depends_on: [02_modules/subscription/spec, 02_modules/infra/spec, 02_modules/author_presence/spec]
code_refs:
  [
    _legacy_web/app/admin/layout.tsx,
    _legacy_web/app/admin/_components/AdminChrome.tsx,
    _legacy_web/app/admin/_components/DashboardPulse.tsx,
    _legacy_web/app/admin/_lib/supabaseBrowser.ts,
    _legacy_web/app/admin/_lib/adminApi.ts,
    _legacy_web/app/admin/_lib/adminDates.ts,
    _legacy_web/app/admin/_lib/countryNamesRu.ts,
    _legacy_web/app/admin/login/page.tsx,
    _legacy_web/app/admin/page.tsx,
    _legacy_web/app/admin/payments/page.tsx,
    _legacy_web/app/admin/payments/stats/page.tsx,
    _legacy_web/app/admin/payments/catalog/page.tsx,
    _legacy_web/app/api/admin/payment-catalog/route.ts,
    _legacy_web/app/api/admin/payment-catalog/[id]/route.ts,
    _legacy_web/app/admin/users/stats/page.tsx,
    _legacy_web/app/api/admin/me/route.ts,
    _legacy_web/app/api/admin/dashboard/route.ts,
    _legacy_web/app/api/admin/feedback/route.ts,
    _legacy_web/app/api/admin/feedback/attachments/[id]/route.ts,
    _legacy_web/app/api/admin/users/route.ts,
    _legacy_web/app/api/admin/users/[id]/route.ts,
    _legacy_web/app/api/admin/users/stats/route.ts,
    _legacy_web/app/api/admin/payments/route.ts,
    _legacy_web/app/api/admin/payments/[id]/route.ts,
    _legacy_web/app/api/admin/payments/stats/route.ts,
    _legacy_web/app/api/admin/_utils/payments.ts,
    _legacy_web/app/api/admin/_utils/membershipFromPayments.ts,
    _legacy_web/app/api/admin/metrics/route.ts,
    _legacy_web/app/api/admin/prompts/route.ts,
    _legacy_web/app/api/admin/stories/process/route.ts,
    _legacy_web/app/api/admin/stories/cleanup/route.ts,
    _legacy_web/app/api/_utils/supabase.ts,
    _legacy_web/public/admin-manifest.json,
    modules/access/core/tiers.ts,
    modules/support/core/supportClient.ts,
    modules/metrics/core/appOpen.ts,
    modules/location/acquireAndPersistUserCoordinates.ts,
    supabase/migrations/20260708010000_admin_panel_tier_foundation.sql,
    supabase/migrations/20260708160000_support_messages.sql,
    supabase/migrations/20260708170000_payments_users_admin.sql,
    supabase/migrations/20260708180000_admin_dashboard_metrics.sql,
    supabase/migrations/20260708190000_payments_edited_at.sql,
    supabase/migrations/20260710023000_reconcile_expired_memberships.sql,
    supabase/migrations/20260721120000_admin_dashboard_pulse.sql,
  ]
---

## 1. Назначение

Внутренняя админ-панель владельца продукта (единственный пользователь, только русский язык, не публикуется в сторах). Встроена в существующий Vercel-проект `_legacy_web` как обычные роуты: UI-страницы `app/admin/*` (PWA, mobile-first) и серверные API `app/api/admin/*`. Управляет контентом сообщества (сторис, видео, вебинары), коммуникациями (уведомления, обратная связь), пользователями/тарифами и наблюдаемостью (метрики, промпты).

Полный план внедрения (этапы 0–8) — в утверждённом плане «Архитектура админ-панели HARMONIZER»; спека описывает только реализованное.

## 2. Публичный контракт

**Авторизация (реализовано, этап 0):**

- **`requireAdmin(req): Promise<string>`** (`_legacy_web/app/api/_utils/supabase.ts`) — гейт каждого роута `app/api/admin/*`: `requireUserId` (JWT) + проверка `public.user_roles.role = 'admin'` через service client. 401 без токена, 403 без роли. Возвращает userId админа.
- **`GET /api/admin/me`** — проба «я админ» для клиентского гейта: `{ userId, displayName }` или 401/403.

**Сторис (реализовано, этап 1, доработано 2026-07-10):** `GET /api/admin/stories`, `POST /api/admin/stories/process`, `PATCH/DELETE /api/admin/stories/[id]`, `POST /api/admin/stories/cleanup`, UI `/admin/stories`. `GET /api/admin/stories` теперь opportunistically запускает cleanup истёкших published non-evergreen stories перед возвратом списка, а регулярное удаление поддерживается тем же helper + hourly cron invoke `cleanup-expired-stories`. Контракт и данные — в `02_modules/author_presence/spec.md` (владелец функциональности).

**Вебинары:** `GET/POST /api/admin/webinars`, `GET/PATCH/DELETE /api/admin/webinars/[id]`, `PUT /api/admin/webinars/[id]/recording` (upsert linked post). UI — вкладки Анонс/Запись; список с одним бейджем (запись XOR анонс); карточка редактора визуально как `PostEditor` (locale strip + dots, лейблы, «Удалить перевод (XX)», Save+Удалить). Контракт — `02_modules/webinars/spec.md`.

**Видео и комментарии (реализовано, этап 2):** `GET/POST /api/admin/posts` (`GET` — cursor infinite scroll, `limit` default 20), `GET/PATCH/DELETE /api/admin/posts/[id]`, `PATCH/DELETE /api/admin/comments/[id]` (модерация: скрыть/удалить; клик по автору → `/admin/users/[id]`), UI `/admin/posts` («Видео»; +`/new`, `/[id]` — `PostEditor`: any-locale, fill-missing «Перевести» + копия обложки, «Удалить перевод»/обложку на вкладке, compress cover; чекбокс «Опубликовать» до первого save). Контракт — в `author_presence`.

**Уведомления (реализовано, этап 4):** `GET/POST /api/admin/notifications`, `DELETE|POST /api/admin/notifications/[id]` (удаление); UI с locale strip как Video + история/удаление. Контракт — `02_modules/notifications/spec.md`.

**Клиентский гейт:** `adminFetch` — Bearer + mutex на `refreshSession`, `AdminApiError` со статусом; `AdminChrome` вызывает `signOut` только при 401/403 от `/api/admin/me` (сетевые сбои не разлогинивают). `getBrowserSupabase()` (`supabaseBrowser.ts`): (1) перед `createClient` подчищает из `localStorage` непригодные `*-auth-token` сессии — нет access/refresh, битый JSON, `expires_at`/JWT `exp` в прошлом или в margin 90 c (число или строка; legacy `currentSession`); (2) ставит узкий фильтр `console.error` на известные refresh `AuthApiError` / `AuthSessionMissingError` от supabase-js, чтобы Next.js 15 dev overlay не перекрывал `/admin/login` после отозванного refresh (задание пароля через Auth Admin API). Без этого `_recoverAndRefresh` / auto-refresh пишет `console.error` даже когда сам удаляет сессию.

**Поддержка (реализовано, этап 5):**

- Таблица `support_messages` (`20260708160000_support_messages.sql`): `user_id`, `body`, `created_at`, `processed_at`. RLS: пользователь пишет/читает свои, админ — всё; API идёт через service role.
- Вложения: бакет `support-attachments` (private, JPEG/PNG/WebP ≤ 3 МБ) + `support_message_attachments` (max 3, cascade). Клиент: `POST /api/support/uploads` → `{path,token,signedUrl}`; PUT через **`FileSystem.uploadAsync`** на `signedUrl` (path с bucket `support-attachments/…`; иначе InvalidSignature). Fallback: `fetch(fileUri).arrayBuffer()` + `uploadToSignedUrl` (не base64). Без `expo-image-manipulator`. `SupportModal`: warm пикера; «Открываю галерею…» / «Отправляю…»; Cancel закрывает форму. Админ: «Файл N» → `adminFetchBlob`; bulk DELETE; бейдж из `unprocessedSupportCount`.
- Клиент: `modules/support` — `sendSupportMessage()` (insert под RLS, лимит 4000 симв.) + `SupportModal` как **View-overlay** (не RN `Modal`): медиатека открывается поверх формы без её размонтирования; иначе PHPicker поверх Modal ломает тачи, а hide-on-pick даёт «форма пропала». Пикер: `preferredAssetRepresentationMode: Compatible` (HEIC→JPEG). Клавиатура: iOS — `KeyboardAvoidingView` `padding` + center; Android — `paddingBottom = IME` + `flex-end`. Успех/ошибки — `AppDialog`. Тексты — i18n `support.*`.
- Админ: `GET|DELETE /api/admin/feedback` (вложения в списке — только metadata), `GET /api/admin/feedback/attachments/[id]` (байты через service-role + Bearer; signed URL private bucket в браузере давал пустую вкладку), `PATCH|DELETE /api/admin/feedback/[id]`, UI `/admin/feedback`.

**Пользователи и платежи (реализовано, этап 6):**

- Таблица `payments` (`20260708170000_payments_users_admin.sql` + `20260708190000_payments_edited_at.sql`) — леджер выдачи платных тарифов: `amount/currency/tier/paid_until/source('manual'|'store'|'promo')/comment` + `edited_at` для пометки правок. RLS admin-only.
- RPC `admin_search_users(p_query, p_tier, p_limit)` — security definer c join на `auth.users` (email не хранится в `public.users`); execute отозван у anon/authenticated, вызывается только service role.
- `GET /api/admin/users?q=&tier=` — поиск по имени/email + фильтр тарифа (до 100 строк). `GET /api/admin/users/[id]` — карточка: профиль, email, история платежей, последняя активность (max `occurred_at` из `user_event_log`); если у пользователя платный tier с уже истёкшим `membership_expires_at`, перед ответом opportunistically вызывается `recomputeUserMembershipFromPayments`. `PATCH /api/admin/users/[id]` `{tier, expires_at?, amount?, comment?}` — ручное назначение: пишет строку в `payments` (source=manual) и пересчитывает `users.membership_*` из действующих платежей; тариф `free` сбрасывает срок и леджер не пишет.
- `GET /api/admin/payments` — единый список: ручные гранты (`payments`) + оплаченные контракты шлюза (`payment_contracts` active/cancelled; Lava.top и ЮКасса). Суммы **gross** в исходной валюте. `PATCH /api/admin/payments/[id]` — только гранты (`gw:*` запрещён); `{tier, expires_at?, amount?, currency?, comment?}`; пересчёт membership + FX nets гранта без комиссии шлюза. Хелпер списка: `_utils/paymentLedger.ts`; membership — `_utils/{payments,membershipFromPayments}.ts`.
- `GET /api/admin/payments/stats?days=&grain=&currency=` — **Статистика выручки** (net): сверху тарифы (Lava+ЮКасса) → блоки Lava.top / ЮКасса → «Общая динамика» → «по странам»; период/валюта/зерно из query. UI `/admin/payments/stats`. Пустой блок ЮКасса — «Оплат нет», без бейджа «скоро».
- `GET /api/admin/payment-catalog` / `PATCH /api/admin/payment-catalog/[id]` — каталог SKU ЮKassa (`payment_catalog`: title, description ≤128, amount; tier/kind/currency read-only). UI `/admin/payments/catalog`.
- UI: `/admin/users`…, `/admin/users/[id]` (история = гранты + Lava.top + ЮКасса; «Редактировать» только у грантов), `/admin/payments`. Бренд шлюзов: **Lava.top** / **ЮКасса**.

**Дашборд «пульс» (реализовано, этап 7 → pulse 2026-07-21):**

- Главная `/admin` — `DashboardPulse`. Контролы: `7|30|90|all` (дефолт **7**) + `day|week` (`all` → только `week`) + валюта ₽/€/$. Порядок блоков: рег/активность → Lava.top/ЮКасса → LLM (топ-3 токенов за 24ч) + страны → воронки Наставник/Мастер.
- RPC `admin_dashboard_pulse` (v3, `20260721160000`): KPI — пользователи (всего/24ч/7д), когортная конверсия (рег / купили oracle / купили master за период), распределение тарифов «сейчас»; series с итогами; воронки подписки oracle/master (мес. 1–7); LLM 24ч + серия токенов; geo по новым за период. KPI «Выручка» (вместо «Переход на 2-й месяц») — net Lava.top+ЮКасса за период.
- `GET /api/admin/dashboard?range=&grain=&currency=` → pulse + overlays net-settlements (`revenue_gateways_net` / lava / yukassa series) + alerts.
- `GET/DELETE /api/admin/users/[id]` — карточка с `country_code`/`city`; delete с confirm, платежи с `buyer_email` сохраняются.
- Клиент: `app_open` → `last_seen_at`; reverse-geocode → `country_code`/`city`.
- **Cleanup OTP-ghosts:** hourly `cleanup_unconfirmed_auth_users` (cron `35 * * * *`, в реестре `ensure_harmonizer_cron_jobs`). Удаляет только `auth.users` где `email_confirmed_at IS NULL` **и** `last_sign_in_at IS NULL` **и** `created_at < now()-24h`, без admin/payments/contracts/onboarded/last_seen. Подтверждённые аккаунты при повторном OTP **не** затрагиваются (`email_confirmed_at` остаётся).

**Промпты (реализовано, этап 8):**

- `GET /api/admin/prompts` — сводка по `prompt_key` (активная/последняя версия, число версий). `GET /api/admin/prompts/[key]` — все версии. `POST /api/admin/prompts/[key]` — новая версия (version = max+1, метаданные наследуются, `activate` — деактивирует остальные). `PATCH /api/admin/prompts/versions/[id]` — активация (единственная активная на ключ; деактивировать активную напрямую нельзя) и правка notes. `POST /api/admin/prompts/test` — playground: рендер шаблона с переменными + прогон через боевой Gemini-пайплайн (`maxDuration 120`), в БД не пишет.
- UI `/admin/prompts` (список ключей) и `/admin/prompts/[key]` (версии, редактор шаблона, playground с автозаготовкой `{{переменных}}`).
- Временный Prompt Studio (`/api/ai/prompt-studio` + `middleware.ts` + WordPress-страница) выведен из эксплуатации: роут и middleware удалены, функциональность покрыта этим разделом. `PROMPT_STUDIO_TOKEN` в Vercel больше не нужен.

**Загрузки:** `POST /api/admin/uploads` `{bucket: 'story-media'|'post-covers', contentType}` → signed upload URL (браузер грузит напрямую в Storage, мимо лимита тела Vercel). Для stories raw upload: файлы ≤45 MiB — signed URL в `tmp/stories/*`; **>45 MiB** — chunked `POST /api/admin/stories/upload-chunk`, сборка в `process` (обход Supabase Free global limit 50 MiB без Pro). После загрузки — `POST /api/admin/stories/process`. На Free-тарифе `supabase config push` **не** поднимет global limit выше 50 MiB (402); chunked path — штатный.
- **Клиент админки** (`app/admin/_lib/`): `getBrowserSupabase()` — anon-клиент только для аутентификации (email/password, сессия в localStorage); `adminFetch(path, init)` — fetch к `/api/admin/*` с Bearer текущей сессии. Данные админка получает **только через API** (service role на сервере), не прямыми запросами к БД.

**UI-каркас (реализовано, этап 0):**

- `app/admin/layout.tsx` — тёмная тема (палитра `modules/ui/theme.ts`, Tailwind v4), PWA-манифест `public/admin-manifest.json` (`start_url`/`scope: /admin`), `robots: noindex`.
- `AdminChrome` — гейт по фазам `checking/admin/anonymous` (редиректы на `/admin/login`), навигация: сайдбар (desktop) + нижняя панель (mobile). Разделы: Дашборд, Сторис, Видео, Вебинары, Уведомления, Поддержка, Пользователи, Платежи, Промпты.
- `/admin/login` — email/password через Supabase Auth; после входа дополнительная проверка `/api/admin/me` (не-админ выкидывается с ошибкой).

## 3. Внутренняя архитектура

- Один деплой с остальным сервером; никакого отдельного проекта Vercel.
- Service role key живёт только в серверных роутах (`createServiceSupabase()`); браузерный клиент — anon key.
- Роль admin назначается вручную SQL-ом (`supabase/README.md` §«Как назначить себе роль admin»).
- Стили — Tailwind v4 без конфига (v4 через `@import "tailwindcss"`), иконки lucide-react. RN UI-kit (`modules/ui/`) на веб не переносится; заимствуются только цветовые токены.
- Формат дат админки централизован в `app/admin/_lib/adminDates.ts`: везде `ДД.ММ.ГГГГ` и `ДД.ММ.ГГГГ ЧЧ:ММ`; сохранение срока оплаты из date-input добавляет текущее локальное время браузера, а не `23:59`.
- Stories upload flow стал двухшаговым: browser signed-upload только складывает raw media в `story-media/tmp/stories/*`, а финальная запись в `stories` создаётся лишь после `process`-роута. Это снижает вес клиентского контракта и держит crop/transcode/poster/thumb generation полностью на сервере.

## 4. Конфигурация

- Env (уже есть в `_legacy_web/.env.local` / Vercel): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Миграция `20260708010000_admin_panel_tier_foundation.sql`: `users.membership_tier` расширен до `free/oracle/practitioner/master` (данные `premium` → `oracle`), добавлен `users.membership_expires_at` (истечение ручного гранта/оплаты; NULL = бессрочно). Семантика доступа — `modules/access/core/paidAccess.ts` (см. subscription).

## 5. Известные ограничения

- Вход только email/password: если аккаунт владельца создан через Apple/Google OAuth, пароль нужно один раз задать в Supabase Studio (Authentication → Users).
- Все разделы этапов 0–8 реализованы; заглушек не осталось.
- `is_admin()` в RLS остаётся защитой на уровне БД; серверные админ-роуты работают через service role + `requireAdmin` и на RLS не полагаются.
- Списки платежей показывают **gross** (как платил пользователь). Выручка (дашборд / `/admin/payments/stats`) — **net** в выбранной валюте: шлюзы из `payment_settlements` (комиссия + FX; `provider` lavatop|yookassa), гранты из `payments.net_amount_*`. Воронки Наставник/Мастер считают все `payment_contracts` подписок (оба шлюза). Автооплата/renewal ЮKassa при истечении срока **не** реализованы (`YOOKASSA_RECURRING_ENABLED`).
- KPI active_24h/7d на пульсе — по `users.last_seen_at` (заполняется с клиента при `app_open`); до раскатки нового клиента цифры занижены. Серия `active_users` в pulse — distinct `user_id` в `user_event_log` за бакет.
- Geo (`country_code`/`city`) появляется только после раскатки клиента с persist reverse-geocode; исторической ретроспективы нет — `meta.partial` содержит `geo`, пока срез пуст.
- LLM load/top-tokens зависят от событий `dialog_turn` / `llm_prompt_size` (пишутся из communicator dialog после успешного insert хода). Пока логов мало — `meta.partial` включает `top_tokens_sparse`; карточки не притворяются нулевой истиной без оговорки.
- Пороги алертов захардкожены в `/api/admin/dashboard` (`TOKEN_ALERT_THRESHOLD_24H=80000`, `LLM_ERROR_ALERT_THRESHOLD_24H=15`); UI настроек порогов пока нет.
- Stories media pipeline рассчитан на короткий контент: фото до 30 МБ, raw video до 120 МБ и до 90 секунд. Ограничения enforced уже на upload/process-роутах, чтобы `ffmpeg` укладывался в serverless runtime.
