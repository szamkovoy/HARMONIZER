---
id: 02_modules/webinars/spec
title: Webinars Spec
version: 3.6
updated: 2026-09-14
depends_on: [01_foundation/product_model, 02_modules/subscription/spec, 02_modules/author_presence/spec, 02_modules/admin_panel/spec, 02_modules/i18n/spec]
code_refs:
  [
    modules/webinars/index.ts,
    modules/webinars/core/webinarsClient.ts,
    modules/webinars/core/webinarTiming.ts,
    modules/webinars/ui/WebinarScreen.tsx,
    modules/webinars/ui/UpcomingWebinarBanner.tsx,
    modules/webinars/ui/WebinarsStrip.tsx,
    app/webinar/[id].tsx,
    app/(tabs)/index.tsx,
    modules/posts/ui/PostsFeedScreen.tsx,
    _legacy_web/app/admin/webinars/page.tsx,
    _legacy_web/app/admin/webinars/_components/WebinarEditor.tsx,
    _legacy_web/app/api/admin/webinars/route.ts,
    _legacy_web/app/api/admin/webinars/[id]/route.ts,
    _legacy_web/app/api/admin/webinars/[id]/recording/route.ts,
    _legacy_web/app/api/admin/webinars/webinarPayload.ts,
    modules/access/core/features.ts,
    supabase/migrations/20260708140000_webinars.sql,
    supabase/migrations/20260713200000_webinars_announce_recording.sql,
  ]
---

## 1. Назначение (продукт)

Вебинары автора в двух фазах:

1. **Анонс** — дата/время, обложка, i18n-тексты, ссылка на трансляцию, регистрация, блок «Вопросы для обсуждения».
2. **Запись** — после `starts_at + 1h` вкладка в админке становится письмом участникам. Кнопка «Отправить письмо участникам» сохраняет текст как неопубликованный `posts.kind='webinar_recording'` (`is_published=false`, без обложки) и отправляет письмо. В ленту и на главную запись не попадает.

## 2. Публичный контракт

### Клиент (`modules/webinars`)

- **`webinarTiming`**: `WEBINAR_JOIN_GRACE_HOURS = 1`, `isWebinarInJoinWindow`, `isWebinarRecordingTabAvailable`, `formatWebinarBannerWhen`.
- **`WebinarScreen`**: обложка + локализованные title/description; дата/время без года (меньший шрифт) + `(ваш часовой пояс)`; loading — только спиннер; в join-окне — регистрация (гейт `webinar_community`: только **оплаченный** Master; trial/free → `AccountGateDialog` + кабинет) и после записи блок «Вы зарегистрированы» + `join_url` (кнопки «Отменить запись» нет — отмена без возврата денег лишена смысла; Master-регистрация остаётся ручной, разовая оплата вебинара регистрируется вебхуком автоматически); вопросы = тот же `CommentsSection`/`CommentComposer`/`POST /api/comments`, что и у видео (`headingKey`/`hintKey` для copy; композер над клавиатурой как `PostScreen`). После окна ссылка на запись есть только у ранее опубликованного поста или legacy `recording_url`; новое письмо записи в приложении ссылку не создаёт.
- **`UpcomingWebinarBanner`**: ближайший опубликованный вебинар с `isWebinarInJoinWindow` и **exact** title для UI-локали (`fetchUpcomingWebinar(locale)` + `localizeWebinar`); без перевода локали — скрыт. Текст `formatWebinarBannerWhen · title`.
- **`WebinarsStrip`**: компонент сохранён; во вкладке «Видео» не монтируется — анонсы только на главной. Новое письмо о записи в ленту не попадает.
- **`webinarsClient`**: `fetchUpcomingWebinar`, `fetchWebinars`, `fetchWebinar`, `localizeWebinar`, регистрации; `registerWithWebinarPass(webinarId, userId)` — RPC `apply_my_webinar_passes` (запись по пропуску с виджета лендинга, сервер проверяет окно и кредиты) → `isRegistered`. `WebinarScreen` вызывает его, если гейт `webinar_community` закрыт; не записал → `AccountGateDialog`.

### Админка

- Список: `GET /api/admin/webinars?limit=&offset=` → `{ webinars, total, … }`, UI — infinite scroll; заголовок = название анонса; бейдж — «Анонс опубликован»/черновик (старый опубликованный пост записи ещё может показать «Запись опубликована», пока письмо не отправят заново); участники → `/admin/users/{id}`.
- Карточка: вкладки **Анонс** / **Запись**. Анонс — как у `PostEditor` (обложка, «Заголовок/Текст», чекбокс публикации). Запись — письмо: без обложки, тема и текст, русский шаблон уже вставлен (`{{name}}`), «Перевести», кнопка «Отправить письмо участникам». `PUT …/recording` всегда пишет `is_published=false`.
- Вопросы анонса — `created_at` ascending (свежие внизу), как в приложении.

### Данные

- `webinars`: + `cover_url`, `title_i18n`, `description_i18n`, `cover_url_i18n`, `translations_updated_at`; `is_published` = анонс; `recording_url` deprecated; **`start_notified_at`** — после авто-пуша старта (Edge `notify-webinar-start`, см. `notifications`).
- **Авто-пуш старта:** minutely cron → записавшимся с `join_url`, текст на `users.locale` («вебинар начинается» + ссылка). Не вручную из админки. SQL-инвокер `invoke_notify_webinar_start` (с `20260914010000`) сам проверяет окно due (`is_published`, `start_notified_at is null`, `join_url`, `starts_at ∈ [now−15m, now+30s]`) и зовёт Edge только когда есть что уведомлять; окно должно совпадать с `CATCH_UP`/`LOOKAHEAD` в `supabase/functions/notify-webinar-start`.
- `posts.kind` ∈ (`video`, `webinar_recording`), `posts.webinar_id`; unique one recording per webinar.
- RLS + `get_posts_feed`: published `webinar_recording` виден как обычное video (миграция `20260714003000_webinar_recording_feed_like_video.sql`); live `join_url` по-прежнему через регистрацию.
- Вопросы: `comments` `target_type='webinar'`; комментарии записи: `target_type='post'`.
- **Пропуск на вебинары** (`20261007190000`, покупка «Участие в вебинаре» / «Четыре вебинара» с виджета лендинга, см. `account_web` §3.4): `webinar_passes` (`credits`, `[valid_from, valid_until)`, `active|revoked`; RLS select own). `apply_webinar_passes(p_user_id?)` записывает владельцев на **опубликованные** вебинары окна (`starts_at` в окне и не раньше `now − 1h`), не больше `credits`; `webinar_registrations.pass_id`. Вызов — при оплате и когда анонс сохраняют опубликованным (кнопка «Записаться» в приложении — `apply_my_webinar_passes`). Пятиминутного крона нет (`20261008030000`).
- **Письма** (`webinarNotices.ts`, одно на человека, `webinar_notice_sends`): приглашение — когда опубликованный анонс имеет описание и ссылку на комнату, адресаты — действующий Мастер и те, чей пропуск покрывает этот старт. Текст = приветствие + описание анонса + кнопка «Перейти в вебинарную комнату» (адрес комнаты внутри кнопки, отдельной строкой не печатается), сразу под ней «Код доступа: 123456» (в других языках переведены подпись кнопки и подпись кода), затем отступ и подпись. Те же отправки видны в карточке пользователя, блок «Письма». Запись — кнопка «Отправить письмо участникам»: тема и текст вкладки уходят как есть (шаблон уже содержит приветствие и подпись, `{{name}}` заменяется именем), плюс только футер рассылки. Отдельной публикации в приложении нет. Адресаты записи — у кого на момент `starts_at` была оплата (период Мастера, пропуск с ещё не израсходованным кредитом или разовая оплата этого вебинара). Нет перевода темы и текста в язык человека — всё письмо по-русски. Напоминаний нет. Пуш старта — по-прежнему `notify-webinar-start` записавшимся.

## 3. i18n

Ключи `webinars.*` (в т.ч. `questionsTitle`/`questionsHint`/`questionPlaceholder`, `registeredTitle`/`registeredBody`, `registerPaidCta`). Даты — Luxon + активная локаль. Контент анонса/записи — `*_i18n` + admin translate; `localizeWebinar` = **exact** UI locale (`pickExactLocalizedText`); без перевода локали → баннер/карточка скрыты.

## 4. Легаси

`announcements.kind='webinar'` не используется. `recording_url` читается клиентом только если linked post ещё нет.
