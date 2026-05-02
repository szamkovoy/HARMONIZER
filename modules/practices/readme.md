# Practices Module

Единый клиентский контракт каталога практик.

## Что входит

- `core/types.ts` — типы `PracticeKind`, `PracticeSummary`, `PracticeLaunchParams`, `PracticeCatalogFilters`.
- `core/catalog.ts` — сбор каталога и второй-виток ранжирования: quality/rating, `params.recorded_at`, длительность и фильтр по чакрам.
- `core/selector.ts` — чистая общая логика выбора практики для каталога и Vercel assistant route: `kind`, чакра, длительность, recent stack, quality, `recorded_at`.
- `core/recommendation.ts` — общий публичный контракт `PracticeRecommendation`, который backend отправляет как `complete.practicePicked`, а RN-клиент отображает карточкой.
- `ui/PracticeCatalogScreen.tsx` — экран групп "Медитации", "Дыхание", "Асаны" с фильтрами по чакре и длительности.
- `ui/PracticeCard.tsx` — карточка практики с метаданными и запуском.
- `ui/launchPractice.ts` — единый RN-helper запуска практики из каталога или карточки ассистента.
- `services/practiceSessions.ts` — запись завершенных практик в `practice_sessions` и чтение `user_daily_stats`.

## Архитектура каталога и ассистента

- `modules/practices/core/selector.ts` не импортирует React Native, Expo, Supabase и Vercel helpers. Это единственное место для инвариантов ранжирования.
- RN-каталог отвечает за сбор клиентских источников: статическая медитация, `BREATH_PRACTICES`, yoga metadata из Supabase.
- Vercel route `_legacy_web/app/api/communicator/v2/dialog/route.ts` вызывает server-side адаптер `_legacy_web/app/api/communicator/v2/dialog/practiceSelection.ts`, который загружает `practices`, `practice_chakras`, `practice_sessions` и адаптирует строки в selector candidate.
- Контракт карточки рекомендации живет в `PracticeRecommendation`; клиентский `PracticePicked` является совместимым алиасом для данных из SSE.
- `practice_sessions` является источником recent stack для ассистента; `user_daily_stats` остается read model для статистики профиля и не участвует в выборе конкретной практики.
- Ассистент не получает права выдумывать ID практик: он видит shortlist, может объяснить выбор маркером, но финальный `practicePicked` всегда пересобирается backend selector’ом.

## Инварианты selector

- Для асан фильтр длительности применяет окно `targetDurationSec ±15%`; если окно пустое, selector возвращается к практикам нужной чакры или общему списку.
- Recent stack исключает завершенные и недавно предложенные практики. Для `yoga` лимит 15, для `breath`/`meditation` лимит равен количеству активных практик выбранного типа.
- Сортировка рекомендации: `quality/rating desc`, затем `recorded_at asc`, затем близость длительности и стабильный `id`; если для асан нет попаданий в окно длительности, fallback сначала ищет ближайшее время.
- Сортировка каталога: `quality/rating desc`, затем `recorded_at asc`, затем bucket длительности, затем стабильный slug.
- Nullable `quality` и `recorded_at` не ломают выбор: качество по умолчанию считается средним, отсутствующая дата уходит в конец.

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

Meditation "Вспышка" тоже сохраняет завершение через `practice_slug='sacred-symbol-stream'`, даже если записи meditation еще нет в Supabase `practices`. Это нужно для статистики и recent stack.

## Текущее состояние второго витка

- Общий selector живет в `core/selector.ts`; RN и Vercel не дублируют правила ранжирования.
- Общий контракт рекомендации живет в `core/recommendation.ts`; `complete.practicePicked` и клиентская карточка используют совместимую форму.
- Server-side adapter `practiceSelection.ts` загружает Supabase-кандидатов, добавляет статическую "Вспышку", читает `practice_sessions` и собирает launch payload.
- Все типы практик пишут `practice_sessions`: breath, yoga/asana и meditation.
- `launchSource` прокидывается в session context как `catalog` или `assistant`.
- `ui/launchPractice.ts` покрыт тестами на assistant recommendation, catalog meditation и пустой payload.
- Старый endpoint `communicator/v2/select-practice` оставлен как wrapper поверх нового selector.

Остался ручной smoke test на авторизованном окружении: довести диалог до `suggest_practice`, убедиться, что `complete.practicePicked` приходит в SSE, карточка запускает нужный экран, а завершение практики появляется в `practice_sessions` и влияет на следующую рекомендацию.
