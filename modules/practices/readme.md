# Practices Module

Единый клиентский контракт каталога практик.

## Что входит

- `core/types.ts` — типы `PracticeKind`, `PracticeSummary`, `PracticeLaunchParams`.
- `core/catalog.ts` — сбор каталога: Breath из `BREATH_PRACTICES`, медитация "Вспышка" как статическая запись, асаны из Supabase `practices` с `kind='yoga'`.
- `ui/PracticeCatalogScreen.tsx` — экран групп "Медитации", "Дыхание", "Асаны".
- `ui/PracticeCard.tsx` — карточка практики с метаданными и запуском.

## Контракт запуска

- `breath` запускает `/breath-coherence` с `practiceId`, `durationMs`, `chakra`.
- `meditation` запускает `/sacred-symbol-stream`.
- `yoga` запускает `/asana-practice` с `practiceId`; на первом витке это экран-заглушка под Vimeo metadata.

## Данные асан

На первом витке миграция не требуется. Vimeo metadata хранится в существующих полях:

- `video_provider='vimeo'`;
- `video_external_id`;
- `default_duration_sec`;
- `rating` как качество;
- `params.recorded_at` и `params.duration_policy='fixed'`;
- несколько чакр через `practice_chakras`.
