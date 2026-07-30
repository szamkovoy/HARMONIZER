---
id: 02_modules/admin_panel/history
title: Admin Panel History
version: 1.2
updated: 2026-07-21
depends_on: [02_modules/subscription/spec]
code_refs: [supabase/migrations/20260708010000_admin_panel_tier_foundation.sql]
---

## Decision Log

- **2026-07-30 (client geo place sync):** Документирован клиентский фикс: `country_code`/`city` после GPS в онбординге + `maybeSync` на каждом `logAppOpen` (не только вне throttle). Нужен новый мобильный билд; бэкенд не менялся.

- **2026-07-30 (users Demo badge):** Список/карточка показывают **доступ сейчас** (`AccessNowBadge`: trial → «Демо»), а не сырой `membership_tier` (free всегда выглядел как «Навигатор»). Фильтр «Демо» уже был (`access=trial`); сырой тариф переименован в «Тариф в БД». Доступ пользователей не меняется — только админ-UI.

- **2026-07-29 (post translate timeout):** `adminFetch({ timeoutMs })` для `/api/admin/translate` (180s); роут чанкует post-перевод; источник — активная вкладка; EN→все кроме RU.

- **2026-07-29 (post edit list return):** Save в редакторе видео → `/admin/posts`; 🌐 только при реальном i18n.

- **2026-07-29 (video duration):** В `PostEditor` поля длительности ЧЧ/ММ/СС → `duration_seconds`; превью бейджа на обложке.

- **2026-07-29 (video publish date):** В `PostEditor` дата публикации + статусы Черновик/Планируется/Опубликовано; кнопка «Запланировать» без галочки.

- **2026-07-28 (Auth 522 hang):** Все разделы крутили «Загрузка» — Supabase Auth `/auth/v1/user` отдавал 522/504, а `requireUser` ждал без лимита. Перешли на PostgREST-проверку JWT + hard timeout 8s → 503 вместо бесконечного спиннера.

- **2026-07-28 (list cards + payments timeout):** Канон списков — карточка на запись (`AdminListCard`); уведомления/рассылки/шаги переведены с `divide-y`. Удаление из списка где безопасно. Платежи: `buyer_email` first, Auth email только для пробелов; limit 50 — фикс таймаута при Auth 504.

- **2026-07-28 (users stats geo/locale):** Страны и языки на `/admin/users/stats` — по `onboarded_at` выбранного периода; заголовки с периодом; единая сетка полос с динамикой регистраций; API `by_locale` (только ненулевые).

- **2026-07-28 (letter deep-link + KPI):** Клик по письму цепочки → страница шага; KPI доставляемости компактные («Недоставлено», без «Ошибки»/подписей).

- **2026-07-28 (user card chains):** Блок «Автоцепочка» — активные enrollments + «Отменить». История «Письма»: цепочка · название цепочки · название письма; рассылка · название рассылки.

- **2026-07-28 (wipe + reattach ledger):** Admin delete → `wipeUserAccount` (как Profile). Reattach orphan-платежей по `buyer_email` при signup/backfill (`account_web`). Список платежей: fallback имени на email local-part.

- **2026-07-28 (payments list + revenue all-time):** `/admin/payments` — плоский список как пользователи (без карточки «История платежей»). `/admin/payments/stats` — период «Всё время» + разделитель перед Дни/Недели; API `days=all`.

- **2026-07-28 (stats links + district centre):** Ненулевые цифры статистики → `/admin/users` с фильтрами (access/addon/country/onboarded). Geo: из «…ский муниципальный округ» → центр («Осташков»), confirm search ≤100 км.

- **2026-07-28 (stats UX + geo town + maps link):** Stats: всего = onboarded; «Распределение по тарифам сейчас» (Демо слева); допы = unique webinar/book buyers; период «Всё время». Карточка: светлая «Запустить»; city → районный центр (Nominatim zoom=10); местонахождение → Google Maps search URL без API на load.

- **2026-07-28 (user card + filters + notifications F):** Карточка — Общее/Гармонизатор, marketing_status, subscription + отмена оплаты, истории ≤10 + ссылки `?user_id=`. Уведомления list-first (draft/`sent_at`). Фильтры `admin_search_users` + stats по `onboarded_at`. Geo: `pickSettlementCity` + repair city на GET. Миграция `20260728160000`.

- **2026-07-27 (notification detail UX):** Карточка `/admin/notifications/[id]` — заголовок «Уведомления», название над текстом; KPI с пояснениями (получатели / в приложении / push).

- **2026-07-27 (login proxy):** Browser → Auth с валидным apikey зависал (0 bytes); логин через `POST /api/admin/login` (Vercel → GoTrue). `sb_*` ключи не шлём в `Authorization`. На `/admin/login` AdminChrome не вызывает getSession.

- **2026-07-27 (login after hang):** Таймаут getSession оставлял lock supabase-js → login минутами и ложный «Неверный пароль». `resetBrowserSupabase`, очистка storage перед sign-in, реальные тексты ошибок, timeout login 25s.

- **2026-07-27 (adminFetch hang):** Save зависал — `getSession()` мог бесконечно ждать auto-refresh. Таймауты на getSession/refresh/fetch; proactive refresh; prune localStorage только для уже expired (не near-expiry).

- **2026-07-27 (email assets auth):** Загрузка картинок в редакторе писем через `adminFetch` (refresh JWT); timeout refresh 12s; без `alert(Unauthorized)`; кнопки Save показывают «Сохранение…».

- **2026-07-27 (email shared foundation):** Рассылки и цепочки на общем UI (список + workspace); страница письма цепочки; тест шага.

- **2026-07-27 (campaign/notification parity):** Рассылка — заголовок/статус RU, KPI, read-only после send; уведомление — вкладки языков; сегмент email — даты регистрации.

- **2026-07-27 (user card messaging UX):** Фикс истории уведомлений (битый select `status`); лёгкие списки писем/пушей со ссылками; confirm перед отправкой; комбо рассылок — 10 недавних; карточка уведомления `/admin/notifications/[id]`.

- **2026-07-27 (deliverability):** Ссылка «Deliverability» со списка рассылок → `/admin/email/deliverability`. См. `marketing_email/history`.

- **2026-07-27 (user card messaging + chains):** Карточка пользователя — списки писем/уведомлений, отправка, запуск цепочки, opt-out автоцепочек. Сегмент push `user:<id>`. См. `marketing_email/history`.

- **2026-07-25 (admin light + Рассылки):** Светлая тема всей админки; пункт меню «Рассылки»; UX preview/editor. См. `marketing_email/history`.

- **2026-07-24 (marketing_email phase A):** Пункт меню «Письма»; консоль модуля `marketing_email` (кампании Resend ru). См. `marketing_email/history`.

- **2026-07-24 (notifications exact locale):** Рассылка — только exact copy на `users.locale` (очищенная вкладка = пропуск получателя); UI сбрасывает «Отправлено…» при правке черновика. Детали — `notifications/history`.

- **2026-07-24 (support upload InvalidSignature):** Native PUT падал `400 InvalidSignature` — в URL не было имени bucket (`…/sign/{path}` вместо `…/sign/support-attachments/{path}`), затем тихий fallback в base64 (~минуты). Фикс: URL как у supabase-js + API отдаёт `signedUrl`; fallback `fetch(uri).arrayBuffer()` вместо base64.

- **2026-07-24 (support upload perf):** Android: долгая отправка ~1 МБ из‑за `readAsStringAsync(base64)` + JS decode. Upload → `FileSystem.uploadAsync`; warm галереи + spinner. Resize manipulator не добавляли.

- **2026-07-24 (support keyboard + theme):** Android IME перекрывал «Отправить». iOS оставлен на `KeyboardAvoidingView`; Android — `paddingBottom = IME height` + `flex-end` (absolute overlay не в resized-зоне; без padding форма уезжала вниз). Подтверждение через `AppDialog`.

- **2026-07-24 (support picker overlay):** PHPicker из RN `Modal` ломал тачи; hide-on-pick убирал форму с экрана. `SupportModal` → absolute View-overlay (форма остаётся), пикер поверх; `Compatible` для HEIC. iOS + Android. Metro reload.

- **2026-07-23 (favicon):** В `_legacy_web/public/icons/` добавлены PNG/ICO из `assets/images/icon.png` (раньше layout ссылался на отсутствующие файлы). Metadata админки/корня указывает favicon 16/32 + apple-touch + 192/512.

- **2026-07-22 (ЮКасса в админке + каталог):** Убран бейдж «скоро» / текст «не подключена» у блока ЮКасса (дашборд + stats) — пустое состояние как у Lava. Карточка пользователя: история уже из `payment_contracts` любого provider; текст удаления упоминает ЮКасса. Каталог SKU: `GET/PATCH /api/admin/payment-catalog` + UI `/admin/payments/catalog` (title/description/amount). Воронки и сводные отчёты уже суммируют оба шлюза.

- **2026-07-22 (dashboard bar width):** `BarList` на дашборде — flex без широких колонок суммы/даты (симметричные отступы, длиннее полоски), как на `/admin/payments/stats`.

- **2026-07-22 (dashboard layout defaults):** Дефолтный период 7 дн. (дашборд + stats); порядок блоков: рег/активность → выручка шлюзов → LLM/страны → воронки; топ-3 по токенам за 24ч с рангами 1–3.

- **2026-07-22 (stats polish):** На `/admin/payments/stats` — скрывать нулевые продукты; без чипов тарифов в «Общей динамике» и без «Всего» в «по странам»; убрано «(net)» из подписей; длиннее полоски графиков (flex, сумма по содержимому).

- **2026-07-22 (dashboard/stats UX):** KPI «Выручка» (net Lava.top+ЮКасса) вместо «Переход на 2-й месяц»; hint Lava без грантов; фикс столбцов «Токены по дням» (px-высота); stats — без верхних мини-карточек, порядок тарифы→шлюзы→общая динамика→страны; бренды Lava.top / ЮКасса.

- **2026-07-22 (платежи vs выручка):** Списки платежей = gross (Lava.top+гранты; у Lava.top нет «Редактировать»). Статистика выручки — net, блоки Lava.top/ЮКасса, тарифы+динамика по обоим шлюзам, переключатель валюты; у гранта выбор валюты и FX nets без комиссии. Миграция `20260722040000`.

- **2026-07-22 (Lava net revenue + FX):** Дашборд и payments-stats суммируют `payment_settlements.net_amount_*` (после 8% Lava и конвертации); UI-переключатель ₽/€/$. Источник settlement — вебхук account_web. Миграция `20260722020000`.

- **2026-07-21 (KPI order + brand + city):** Порядок KPI: Пользователи → Распределение → Конверсия → 2-й месяц; сайдбар «Гармонизатор»; город/страна — отдельные поля, фон reverse-geocode + backfill `city` из `location_name`.

- **2026-07-21 (pulse v3 + OTP cleanup):** KPI: пользователи 3-цифры, когортная конверсия рег→покупки, продление 2-го месяца oracle/master, тарифы «сейчас»; большие блоки — воронки Наставник/Мастер (мес. 1–7); итоги в регистрациях/уникальной активности; названия с периодом; LLM упрощён + столбцы токенов. Hourly `cleanup_unconfirmed_auth_users` (строго never-confirmed + never signed-in + 24h). Миграция `20260721160000`.

- **2026-07-21 (dashboard UX feedback):** Убраны subtitle и алерт поддержки; KPI уточнены; даты newest-first; тёмный scrollbar; «Распределение по тарифам» (Демо первым); Lava+«Всего»/гранты + слот Яндекс; блок конверсий; период «Всё время» (только недели); geo по новым за период + backfill RU; серия токенов в LLM; карточка пользователя — местонахождение + DELETE с confirm. Миграция `20260721143000`.

- **2026-07-21 (dashboard pulse):** Главная `/admin` перестроена в «пульс проекта»: убрана сетка «Разделы»; UI `DashboardPulse` + `GET /api/admin/dashboard` + RPC `admin_dashboard_pulse` (миграция `20260721120000`). Live: регистрации, access mix (Навигатор/Демо/Наставник/Мастер), активность, Lava-выручка, LLM load/алерты. Geo/top-tokens честно помечаются `meta.partial`, пока клиент/логи не наполнят. Клиент пишет `users.country_code`/`city`/`last_seen_at`. Dialog логирует `dialog_turn` + `llm_prompt_size`. Stats users/payments усилены зерном day/week и разделением Lava vs гранты.

- **2026-07-21 (refresh AuthApiError overlay):** Оверлей `Invalid Refresh Token: Refresh Token Not Found` на `/admin/login` вернулся. Прежний prune смотрел только numeric `expires_at` и не глушил `console.error` supabase-js (auto-refresh / recover всё ещё логируют AuthApiError → Next.js Issue). Fix в `supabaseBrowser.ts`: discard incomplete/malformed/near-expiry sessions (`expires_at` number|string, JWT `exp`, legacy `currentSession`); + узкий `console.error` filter только для refresh-token AuthApiError / AuthSessionMissingError.

- **2026-07-19:** QA: на `/admin/webinars` (и любой странице админки) в dev Next.js 15 показывал полноэкранный оверлей `AuthApiError: Invalid Refresh Token: Refresh Token Not Found`. Причина: в `localStorage` оставалась сессия с истёкшим `access_token` и отозванным `refresh_token` (повтор сценария 2026-07-08 (4) — задание пароля через Auth Admin API отзывает refresh-токены). `getBrowserSupabase()` → supabase-js `_initialize → _recoverAndRefresh` находил сессию, пытался refresh-нуть, получал `AuthApiError` и делал `console.error(error)` (`GoTrueClient.js:3818`), после чего сам удалял сессию и эмитил `SIGNED_OUT`. Next.js dev overlay перехватывает `console.error` и рисует красный оверлей, перекрывая UI, хотя приложение само уходило бы на `/admin/login`. Фикс: `getBrowserSupabase()` теперь перед `createClient` подчищает из `localStorage` все `*-auth-token` сессии с истёкшим `access_token` (margin 90 c = `EXPIRY_MARGIN_MS` auth-js) — `_initialize` не находит сессию → нет попытки refresh → нет `console.error` → `AdminChrome` чисто уводит на логин. Дополнительно в `adminApi.ts` на mutex `refreshAccessToken` добавлен `.catch(() => null)`, чтобы не-auth ошибка refresh-а не стала unhandled rejection.

- **2026-07-14 (10):** Support upload: RN `fetch(uri).blob()` + `uploadToSignedUrl` писал в Storage объекты размера 0 (eTag empty); переход на `expo-file-system` → ArrayBuffer. Старые пустые вложения невосстановимы — пользователь шлёт снова.
- **2026-07-14 (9):** Admin «Файл N» сразу скачивает вложение (lightbox убран — превью показывало битую иконку).
- **2026-07-14 (8):** Admin attachment open/download через `GET /api/admin/feedback/attachments/[id]` + blob URL (signed URL private bucket открывал пустую вкладку). Copy формы поддержки обновлён в каталоге i18n.
- **2026-07-14 (7):** Support screenshots (max 3, private bucket) + admin attachment icons/lightbox + bulk delete + unprocessed badge in nav. Migration `20260714160000`.

- **2026-07-14 (6):** QA: удаление уведомления выкидывало на логин — `AdminChrome` делал `signOut` на любую ошибку `/api/admin/me`, плюс параллельные `refreshSession` сжигали refresh token. Фикс: `AdminApiError` + logout только на 401/403; mutex refresh; `adminFetch` без Content-Type на bodyless; delete уведомления через POST `[id]`.

- **2026-07-14 (5):** Admin webinars list title prefers recording title when post exists.

- **2026-07-14 (4):** Notifications admin: locale strip + Translate + DELETE; Expo sound/priority on send.

- **2026-07-14 (3):** WebinarEditor locale strip / labels / delete-translation / Delete button aligned with PostEditor on both Анонс and Запись tabs.

- **2026-07-14 (2):** Webinar LocaleFields «Удалить перевод» — тот же zinc/hover стиль, что у PostEditor.

- **2026-07-14:** Webinar list single badge + comment XOR question count; unified cover UX (Video + Webinar): add button / scaled preview / delete link; publish checkbox «Опубликовать» before first save.

- **2026-07-13:** Webinar admin dual tabs (announce/recording) + recording upsert API; list badges for announce vs recording publish state.

- **2026-07-13 (14):** Admin `/admin/posts` infinite scroll: `GET /api/admin/posts?limit=20` + cursor `before_created_at`/`before_id` → `next_cursor` (no hard 200 cap).

- **2026-07-13 (13):** `PostEditor` create sets `translations_updated_at`; list 🌐 from `title_i18n` keys too.

- **2026-07-13 (12):** `PostEditor`: «Перевести» копирует обложку источника на fill-missing локали; dedupe upload одного File; «Удалить перевод» / «Удалить обложку» на активной вкладке.

- **2026-07-13 (11):** Раздел «Публикации» переименован в «Видео»; `PostEditor` / `postPayload` / `translate` — публикация с любого языка, «Перевести» только в пустые (RU→EN→…); сжатие обложек; `adminFetch` refresh JWT; ФИО комментатора → профиль пользователя.

- **2026-07-10 (10):** Пересчёт тарифа из леджера платежей больше не копирует «последнюю по created_at» запись без проверки срока. После add/edit платежа (и opportunistic на `GET` карточки при stale expires) сервер выбирает среди ещё действующих платежей максимальный тариф по `TIER_ORDER` (при равенстве — более поздний `paid_until`, затем свежий `created_at`); если действующих нет — `free`. Hourly Edge `reconcile-expired-memberships` + SQL RPC `recompute_user_membership` / `reconcile_expired_memberships` (миграция `20260710023000`) держат `users.membership_*` в актуальном состоянии без ожидания ручной правки. Подписи тарифов в админке сведены к `TIER_LABELS_RU` из `modules/access/core/tiers.ts`.

- **2026-07-10 (9):** Cleanup истёкших stories сделан более надёжным. Раньше код удаления жил отдельно в `POST /api/admin/stories/cleanup`, а фактическое регулярное удаление зависело от внешнего hourly запуска edge-функции; если scheduler не был настроен или не работал, в `/admin/stories` продолжали висеть записи со статусом `Истекла`. Исправление: логика вынесена в общий helper `cleanupExpiredStories`; ручной cleanup-роут использует его же, а `GET /api/admin/stories` теперь запускает cleanup opportunistically перед чтением списка. Дополнительно добавлена миграция `20260709215553_schedule_cleanup_expired_stories.sql`, которая фиксирует hourly `pg_cron` invoke edge-функции `cleanup-expired-stories` на стороне схемы, а не только в операционном runbook.

- **2026-07-09 (8):** Исправлена загрузка видео >50 МБ в stories. Supabase Storage отклонял signed upload (`EntityTooLarge`) из-за глобального лимита проекта 50 MiB, хотя UI и bucket обещали 120/200 MiB. Файлы >45 MiB теперь идут chunked на `POST /api/admin/stories/upload-chunk`, сборка — в `process` (`upload_session_id`). Helper `admin/_lib/storyUpload.ts`, `adminApi` поддерживает FormData.

- **2026-07-09 (7):** Исправлен сбой публикации видео-сторис в `/admin/stories`. Root cause: Node runtime process-роута иногда получал некорректный путь к `ffprobe-static` после bundling (`spawn ... ffprobe ENOENT`), хотя пакет и бинарник были установлены. Решение: stories media pipeline больше не зависит слепо от `ffprobe.path`/`ffmpeg-static` export; пути к бинарникам валидируются через `createRequire(import.meta.url)` → `package.json` → `existsSync/accessSync`. Заодно обновлены пресеты transcoding под stories: `1080x1920`, `30 fps`, `H.264 High`, `AAC 128k`, `+faststart`, fullscreen poster. Код: `_legacy_web/app/api/admin/stories/mediaPipeline.ts`.

- **2026-07-08 (6):** Stories admin flow переведён на server-side media pipeline. Решения: браузер больше не создаёт строку `stories` напрямую после signed upload; raw media уходит в `story-media/tmp/stories/*`, затем `POST /api/admin/stories/process` через `sharp`/`ffmpeg` создаёт финальные optimized assets, `cover_url` для видео и `thumbnail_url` для кольца, и только после этого пишет запись в БД. В `POST /api/admin/uploads` для stories добавлены `folder`/`bytes` и ранние guard'ы по размеру, а для housekeeping — ручной `/api/admin/stories/cleanup`, который батчево удаляет истёкшие сторис вместе с файлами.

- **2026-07-08 (5):** Дошлифован раздел пользователей/платежей после продуктового фидбека. Введена миграция `20260708190000_payments_edited_at.sql`: `payments.edited_at` + RPC `admin_active_users_count(p_hours)`. Админка получила единый helper `app/admin/_lib/adminDates.ts` (формат `ДД.ММ.ГГГГ[ ЧЧ:ММ]` и сохранение `expires_at` с текущим временем браузера), отдельный раздел `/admin/payments` с общим леджером и `/admin/{users,payments}/stats` со сводной статистикой. Карточка пользователя упрощена: убран `Триал до`, `Локаль` переименована в `Язык`, `Онбординг` уточнён как `Заполнил профиль`, назначение тарифа перенесено в модальную кнопку «Добавить платёж», история платежей стала редактируемой; при правке latest-payment сервер пересчитывает `users.membership_tier` и `membership_expires_at`. Навигация и все даты админки унифицированы под новый формат.

- **2026-07-08 (4):** Разбор «пропавших данных» владельца. В `auth.users` два аккаунта: `szamkovoy@gmail.com` (**Google** OAuth, `e2b32ebe…`) — основной со всеми данными (натальные карты, 140 практик, диалоги, роль admin, пароль для админки) и `…@privaterelay.appleid.com` (**Apple**, `21ee0945…`) — почти пустой, создан при самом первом входе 2026-04-23 и заброшен. Владелец всегда входил через Google, но после форс-логаута (установка пароля через Admin API отзывает refresh-токены → «Invalid Refresh Token» на старте) вошёл кнопкой Apple и попал в пустой аккаунт (отсюда же «Natal profile not found» в коммуникаторе). Решение: приложение и админка используют **один** аккаунт — Google (`szamkovoy@gmail.com`); в приложении входить через Google, в админке — email+пароль того же аккаунта. Apple-вход в админку не строим (Sign in with Apple для web требует отдельный Service ID/домены/redirect — не окупается для единственного пользователя). Пустой Apple-аккаунт можно удалить, чтобы исключить повторную путаницу (нужно подтверждение владельца).

- **2026-07-08 (3):** Этапы 5–8 завершены — админка полностью реализована.
  - **Этап 5 (поддержка):** таблица `support_messages` + RLS self-insert/select; клиентская форма `modules/support` (`SupportModal` в Профиле, insert под RLS без сервера); `/admin/feedback` с отметкой «обработано». Решение: канал односторонний, ответ уходит на почту аккаунта — треды в приложении не строим.
  - **Этап 6 (пользователи):** леджер `payments` (source `manual`/`store`/`promo`; сторы отложены) + RPC `admin_search_users` (security definer c join на auth.users — email не дублируем в public.users); `/admin/users` (поиск, фильтр), карточка с ручным назначением тарифа (пишет и users, и леджер; free сбрасывает срок без записи в леджер).
  - **Этап 7 (дашборд):** RPC `admin_dashboard_metrics`+`admin_llm_metrics` — агрегаты целиком в БД; клиентское событие `app_open` (модуль `modules/metrics`, троттлинг 30 мин, хук в `PushRegistrationBridge`); `DashboardMetrics` на `/admin`. Решение: активность считаем по всем событиям `user_event_log`, а не только `app_open`, чтобы метрика работала и до раскатки нового клиента.
  - **Этап 8 (промпты):** `/admin/prompts` — версии с наследованием метаданных (новая = max+1), инвариант «одна активная на ключ» (деактивация только через активацию другой), generic playground через боевой Gemini-пайплайн. Prompt Studio (`/api/ai/prompt-studio` + `middleware.ts`) удалён; `PROMPT_STUDIO_TOKEN` в Vercel не нужен.
  - Все этапы прошли E2E-смоуки на dev-сервере (скрипты создавали и подчищали тестовые данные). Попутно стабилизирован `vimeo.test.ts`: тест чистил только `VIMEO_ACCESS_TOKEN`, а `vimeoToken()` читает ещё `vimeo_token`/`VIMEO_TOKEN` из корневого `.env.local` — тест ходил в сеть.

- **2026-07-08 (2):** Этап 1 «Stories» завершён: раздел `/admin/stories` (форма загрузки с превью, статусы, toggle публикации, удаление с очисткой Storage), роуты `/api/admin/stories*` + `/api/admin/uploads` (signed upload URL — файл идёт в Storage напрямую из браузера), миграция `20260708120000_stories_storage.sql` (бакет `story-media`, `kind='video'`), клиентское кольцо+вьюер в `modules/stories`. Владелец продуктового контракта — модуль `author_presence`. E2E проверено на dev-сервере (создание→RPC→снятие→удаление с зачисткой бакета). Также решено: пароль владельцу задан через Auth Admin API (recovery-ссылки Supabase сгорали из-за предзагрузки Gmail и вели на страницу без обработчика).

- **2026-07-08:** Этап 0 «Фундамент». Утверждён план архитектуры (этапы 0–8: фундамент → сторис → публикации+комментарии → вебинары → уведомления → обратная связь → пользователи/гранты → дашборд → промпты). Решения: админка встраивается в `_legacy_web` (не отдельный репозиторий/проект), auth через существующий Supabase-аккаунт + роль `user_roles.admin` + новый серверный `requireAdmin()`; публикации — новая таблица `posts` (существующая `announcements` — баннерная модель, остаётся в резерве); комментарии — одна полиморфная таблица для публикаций и вопросов к вебинарам; медиа — Supabase Storage; оплаты — только леджер `payments`, реальная интеграция отложена (решение владельца); уведомления получат гарантированный канал `notification_deliveries` + «Мои уведомления» в Профиле (пуш-разрешения не обязательны). Реализовано: shell `/admin` + login + PWA-манифест + заглушки разделов, `GET /api/admin/me`, миграция `20260708010000` (4 тира, `premium`→`oracle`, `membership_expires_at`), единый хелпер платного доступа `modules/access/core/paidAccess.ts` (вместо 5 дублей условия premium/trial), vendored-копия для Vercel через `scripts/sync-vercel-server-modules.mjs`. Попутно починена история миграций Supabase (3 локальных файла были применены в обход `db push`; удалённый дубль `20260706222434` помечен reverted).
