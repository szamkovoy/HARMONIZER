---
id: 02_modules/infra/build_pipeline
title: Infra Build Pipeline
version: 1.1
updated: 2026-05-06
depends_on: [02_modules/infra/spec]
code_refs: [_legacy_web/next.config.ts, _legacy_web/package.json, package.json, .vercelignore]
---

## 1. Expo (основной клиент)

- Корневой `package.json`: `expo` ~54, `expo-router`, скрипты `start`, `start:dev-client`, `android` / `ios`, `eas-cli` в devDependencies.
- Рекомендуемый локальный запуск из правил проекта: `npx expo start --dev-client`.
- Сборки iOS через EAS: профиль `development` в скрипте `build:ios:dev`.

## 2. Next.js API (`_legacy_web/`)

- Собственный `package.json`: `next` ^15, `react` 19, скрипты `dev` (turbopack), `build`, `start`, `lint`.
- `next.config.ts` задаёт `outputFileTracingRoot` равным директории конфига — важно для монорепо на Vercel.
- Продакшен-сборка API: из корня репозитория с корневым Vercel-проектом, **Root Directory = `_legacy_web`** (см. `.cursor/rules/vercel-deploy.mdc`); не запускать `vercel --prod` изнутри вложенной папки, чтобы не сломать root path.

## 3. Vercel и размер upload

- `.vercelignore` в корне исключает мобильные деревья, большую часть `modules/`, `docs/`, `supabase/` и т.д., оставляя `_legacy_web` и выбранные shared paths (`modules/practices/**`).
- Любое новое server-side `import` из пути вне allowlist требует обновления ignore-файла до деплоя.

## 4. Supabase

- Миграции только добавлением новых файлов в `supabase/migrations/` (`supabase/README.md`).
- Edge Functions деплоятся отдельным контуром CLI/Dashboard, не через Next artifact.

## 5. Тесты

- Корневой `npm test` → `vitest run` (общий для репозитория); `_legacy_web` держит отдельные тесты рядом с utils (например `whisperPrompts.test.ts`).

## 6. Линтинг

- Next: `npm run lint` внутри `_legacy_web/`. Корневой Expo-пакет отдельного eslint-скрипта в `package.json` не объявляет — фактический lint-поверхность зависит от конфигов в подпроектах.
