# Технологический стек HARMONIZER

## Клиент (основной продукт)

- **React Native** + **Expo SDK 54**.
- **Expo Router** (~6.x) — файловый роутинг, каталог `app/`.
- **TypeScript** (strict).
- **UI:** React Native primitives + `react-native-safe-area-context`; анимации — `react-native-reanimated` (шаблон Expo).
- **Аудио:** `expo-av` (запись голоса для модулей вроде COMMUNICATOR); разрешения микрофона задаются через плагин `expo-av` и `app.json` / нативные plist (iOS).

Клиент **не** содержит серверных секретов для Gemini: обращение к модели идёт через развёрнутый HTTP API (см. ниже).

## Сервер и API (Vercel)

- Код и маршруты из архива **`_legacy_web/`** (Next.js App Router): например `POST /api/communicator` с `@google/generative-ai`, цепочка моделей Gemini, переменные `GOOGLE_AI_API_KEY` / `GEMINI_API_KEY` только на сервере.
- **Deployment:** Vercel (или эквивалент) как origin для `EXPO_PUBLIC_COMMUNICATOR_API_URL` (без хвоста `/api/communicator` в переменной — только базовый URL приложения).

Отдельно от «страниц» Next: в продакшене для мобильного клиента важен именно **API-слой**; статическая PWA-оболочка из архива не является целевой платформой.

## Данные и внешние сервисы

- **Supabase:** Auth, PostgreSQL, Storage (на клиенте — `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` через `services/supabase.ts`).
- **Интеграции по продукту:** Hume AI (просодия / эмоции), при необходимости OpenAI и др. — см. `docs/hume_integration.md` и модули.

## Переменные окружения

| Назначение | Пример переменных |
|------------|-------------------|
| Мобильный клиент (Expo) | `EXPO_PUBLIC_COMMUNICATOR_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| Сервер (`_legacy_web` на Vercel) | `GOOGLE_AI_API_KEY`, `GEMINI_MODEL` (опционально), `NEXT_PUBLIC_SUPABASE_*` если веб-часть архива ещё собирается |

Локально: `.env.local` в корне (не коммитится); для Expo переменные с префиксом `EXPO_PUBLIC_` подхватываются при сборке/запуске.

## Репозиторий

- **GitHub** (или аналог), монорепозиторий: клиент Expo + `_legacy_web` как архив API.

## Что намеренно не используется в целевом клиенте

- Next.js как основной UI, **PWA manifest**, **service workers** как обязательная часть продукта (остались только в архиве `_legacy_web`, если его собирают для API).
