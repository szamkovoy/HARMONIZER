# Practices Module

Единый клиентский контракт каталога практик.

## Что входит

- `core/types.ts` — типы `PracticeKind`, `PracticeSummary`, `PracticeLaunchParams`, `PracticeCatalogFilters`.
- `core/catalog.ts` — сбор каталога и второй-виток ранжирования: quality/rating, `params.recorded_at`, длительность и фильтр по чакрам.
- `ui/PracticeCatalogScreen.tsx` — экран групп "Медитации", "Дыхание", "Асаны" с фильтрами по чакре и длительности.
- `ui/PracticeCard.tsx` — карточка практики с метаданными и запуском.
- `services/practiceSessions.ts` — запись завершенных практик в `practice_sessions` и чтение `user_daily_stats`.

## Контракт запуска

- `breath` запускает `/breath-coherence` с `practiceId`, `durationMs`, `chakra`.
- `meditation` запускает `/sacred-symbol-stream`.
- `yoga` запускает `/asana-practice` с `practiceId`; экран показывает Vimeo player metadata/player и кнопку завершения для записи сессии.

## Данные асан

На первом витке миграция не требуется. Vimeo metadata хранится в существующих полях:

- `video_provider='vimeo'`;
- `video_external_id`;
- `default_duration_sec`;
- `rating` как качество;
- `params.recorded_at` и `params.duration_policy='fixed'`;
- несколько чакр через `practice_chakras`.

## Сессии и статистика

На втором витке Breath сохраняет завершение после ответа пользователя "лучше / так же / хуже", а Asana screen сохраняет завершение по кнопке "Завершить практику". `user_daily_stats` не пишется клиентом напрямую: его пересчитывает Supabase trigger после вставки в `practice_sessions`.
