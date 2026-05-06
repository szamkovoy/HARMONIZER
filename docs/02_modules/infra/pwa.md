---
id: 02_modules/infra/pwa
title: Infra Pwa
version: 1.1
updated: 2026-05-06
depends_on: [02_modules/infra/spec]
code_refs: [_legacy_web/app/layout.tsx, _legacy_web/public/manifest.json]
---

## 1. Роль web-shell

`_legacy_web` остаётся хостом HTTP API и минимальной HTML-оболочки. PWA-атрибуты (manifest, иконки, `appleWebApp`) нужны для корректного отображения вкладки, установки на домашний экран в браузере и брендинга; **основной продукт — Expo-приложение**, а не эта оболочка.

## 2. Что задаётся в коде

- **`_legacy_web/app/layout.tsx`** — `metadata.manifest = "/manifest.json"`, набор `icons` под Android/Apple, `appleWebApp.capable`, `viewport.themeColor` для светлой/тёмной схемы, `lang="en"`.
- **`_legacy_web/public/manifest.json`** — `standalone`, цвета, список иконок `192`/`512` с `purpose`.

## 3. Remote Play и публичные страницы

Материал из `docs/remote-play/README.md` (источник плана миграции, файл в корне `docs/` не перемещался в этой задаче):

- Таблица `tv_sessions` и миграция `supabase/migrations/20260503014500_remote_play_tv_sessions.sql` связывают мобильное приложение с публичной TV-страницей через Supabase Realtime.
- WordPress-сниппет (`docs/remote-play/wordpress-snippet.html`) — внешний HTML-контур: подстановка `SUPABASE_URL` / `SUPABASE_ANON_KEY`, ожидание кода пары, Vimeo iframe с жёстким форматом URL (`audiotrack` в query).

Это **не часть Next bundle**, а соседний web-слой; ограничения встраивания Vimeo и домены whitelist — операционные риски инфраструктуры контента, а не RN UI.

## 4. Ограничения

- Service Worker как обязательный компонент продукта не описан и не является целью.
- Локаль `layout` (`lang="en"`) не отражает русскоязычный продуктовый UX мобильного клиента — это только документ web-shell.
