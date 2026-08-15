---
id: 02_modules/book/dependencies
title: Book Dependencies
version: 2.0
updated: 2026-08-14
depends_on: [02_modules/book/spec]
code_refs:
  [
    modules/book/index.ts,
    modules/book/ui/BookReaderScreen.tsx,
    app/(tabs)/profile.tsx,
    _legacy_web/app/api/account/purchases/book/route.ts,
    _legacy_web/app/api/book/manifest/route.ts,
    _legacy_web/app/api/book/progress/route.ts,
  ]
---

## 1. Зависит от

- **`profile`** — карточка в `app/(tabs)/profile.tsx`.
- **`subscription` / access UI** — `AccountGateDialog` + `bodyKey="gate.body.book"` (ownership **не** через `FeatureKey`).
- **`i18n`** — `book.*`, `gate.body.book`.
- **`ui/theme`** — light/dark ридера.
- **`auth`** — JWT для purchases/book, manifest, progress; `user.id` для local progress keys.
- **`account_web`** — покупка `tier=book` в кабинете; `GET /api/account/purchases/book` / shared `bookOwnership.ts`.
- **`infra`** — Vercel env CDN; Supabase `book_reading_progress`; HTTPS на zamkovoi.yoga.
- **EPUB pipeline** — `scripts/book-build-epub.mjs` + `Book/*.docx` / `cover_*.jpg`.

## 2. От него зависят

- **`profile`** — `BookProfileCard`, `resolveBookAccess`, `bookLocaleForAppLocale`.
- **`account_web`** — парный ownership endpoint для ридера.

## 3. Контрактные точки риска

- Store: без active one_time book → gate; без `BOOK_CDN_*` manifest падает.
- Dev: Metro fallback `/hz-book/{locale}.epub` из `book/build/{locale}/book.epub` для локалей без CDN.
- Не ломать существующие `/api/account/{ott,session,overview,checkout,webhooks}` — только новые routes.
