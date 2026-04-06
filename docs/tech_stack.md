# Технологический стек HARMONIZER

## Клиент (основной продукт)

- **React Native** + **Expo SDK 54**.
- **Expo Router** (~6.x) — файловый роутинг, каталог `app/`.
- **TypeScript** (strict).
- **UI:** React Native primitives + `react-native-safe-area-context`; анимации — `react-native-reanimated` (шаблон Expo).
- **Procedural visuals:** `@shopify/react-native-skia` для `MandalaVisualCore` и debug-песочницы видео-медитаций.
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

**Важно:** в `.env.local` должны быть именно **`EXPO_PUBLIC_*`** для клиента. Переменные вида `NEXT_PUBLIC_*` из старого веба **не подставляются** в Expo, пока не продублируете их с префиксом `EXPO_PUBLIC_` (например `EXPO_PUBLIC_COMMUNICATOR_API_URL`). После изменения `.env.local` перезапустите Metro с очисткой кэша: `npx expo start -c`.

На **физическом телефоне** адрес `http://localhost:3000` для API недоступен: укажите **публичный HTTPS** (Vercel) или IP компьютера в локальной сети, если тестируете свой сервер.

## Отладка и логи (Expo Go / dev)

| Где смотреть | Что видно |
|--------------|-----------|
| **Терминал с `npx expo start`** | Вывод `console.log` / `console.error` из JS (в т.ч. `[Communicator]` при ошибках). |
| **Expo Dev Tools** в браузере | Открывается при старте Metro; часть логов дублируется. |
| **Меню разработчика на устройстве** | Встряхните устройство (или `Cmd+D` в симуляторе iOS / `Cmd+M` на Android) → пункты отладки. |
| **iOS:** Xcode → Window → Devices and Simulators → открыть устройство → **Open Console** | Системные и нативные логи. |
| **Android:** `adb logcat` | Фильтр по тегам: `adb logcat *:S ReactNative:V ReactNativeJS:V` — логи JS. |

В модуле COMMUNICATOR при сбое запроса показывается **Alert** с текстом ошибки; тот же текст дублируется в консоль через `console.error`.

У **React Native** у успешного `fetch` часто **`response.body === null`** (нет потокового API, как в браузере). Клиент в `services/communicator-client.ts` в этом случае читает ответ через **`response.text()`** и передаёт текст в тот же парсер стрима — это не ошибка сервера и не обязательно связано с именем модели Gemini.

Скачать «файл лога» из Expo Go одной кнопкой нельзя — ориентируйтесь на терминал Metro и при необходимости копируйте фрагмент вручную или используйте `adb logcat` / консоль Xcode.

## Репозиторий

- **GitHub** (или аналог), монорепозиторий: клиент Expo + `_legacy_web` как архив API.

## Что намеренно не используется в целевом клиенте

- Next.js как основной UI, **PWA manifest**, **service workers** как обязательная часть продукта (остались только в архиве `_legacy_web`, если его собирают для API).
