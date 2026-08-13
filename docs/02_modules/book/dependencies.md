---
id: 02_modules/book/dependencies
title: Book Dependencies
version: 1.0
updated: 2026-08-13
depends_on: [02_modules/book/spec]
code_refs:
  [
    modules/book/index.ts,
    modules/book/ui/BookReaderScreen.tsx,
    app/(tabs)/profile.tsx,
  ]
---

## 1. Зависит от

- **`profile`** — точка входа: карточка в `app/(tabs)/profile.tsx` (после «Мои данные», над поддержкой/отчётами).
- **`subscription` / access UI** — `AccountGateDialog` с опциональным `bodyKey="gate.body.book"` (feature-заглушка `"profile"`; владение книгой **не** через `FeatureKey` / тарифы).
- **`i18n`** — ключи `book.*`, `gate.body.book`; локаль ридера через `useAppLocale`.
- **`ui/theme`** — light/dark ридера следует `useThemePreference` / палитре приложения.
- **`auth`** — `user.id` для ключей локального прогресса.
- **`account_web` (целевая, Phase B)** — покупка `tier=book` уже в кабинете; клиентский ownership API ещё не подключён.
- **EPUB pipeline** — `scripts/book-build-epub.mjs` + исходники `Book/*.docx` / `cover_*.jpg`.

## 2. От него зависят

- **`profile`** — импортирует `BookProfileCard`, `resolveBookAccess`, `bookLocaleForAppLocale`.

## 3. Контрактные точки риска

- **Store review:** `resolveBookAccess` в production всегда `false` — нельзя «случайно» открыть книгу без API до Phase B.
- **Dev EPUB** — `Book/build/{ru,en,de,fr,it,es,pt,nl}/book.epub` + Metro `/hz-book/{locale}.epub`; без локальной сборки `openBookSrc` упадёт.
- **Translate pipeline** — `scripts/book-translate*.mjs` + `GEMINI_API_KEY` (или DeepSeek); артефакты в `Book/translations/` (gitignored).
- **Не трогать** существующие `/api/account/*` ради книги, пока идёт модерация store (см. `book_reader_plan.md` §0).
