---
id: 02_modules/book/spec
title: Book Spec
version: 2.0
updated: 2026-08-14
depends_on: [02_modules/profile/spec, 02_modules/i18n/spec, 02_modules/subscription/spec, 02_modules/account_web/spec]
code_refs:
  [
    modules/book/index.ts,
    modules/book/core/bookIds.ts,
    modules/book/core/bookAccess.ts,
    modules/book/core/bookManifestClient.ts,
    modules/book/core/bookProgressClient.ts,
    modules/book/core/openBookSrc.ts,
    modules/book/core/readingProgress.ts,
    modules/book/core/resolveBookSrc.ts,
    modules/book/ui/BookProfileCard.tsx,
    modules/book/ui/BookReaderScreen.tsx,
    app/book/[locale].tsx,
    app/(tabs)/profile.tsx,
    _legacy_web/app/api/account/purchases/book/route.ts,
    _legacy_web/app/api/book/manifest/route.ts,
    _legacy_web/app/api/book/progress/route.ts,
    supabase/migrations/20260814160000_book_reading_progress.sql,
    scripts/book-build-epub.mjs,
    docs/04_workspace/book_reader_plan.md,
    docs/04_workspace/book_cdn_upload.md,
  ]
---

# Book

## 1. Назначение

Клиентский модуль **учебного пособия** («Йога — путь волшебника»): карточка в Профиле, гейт доступа и EPUB-ридер (epub.js / WebView). Доступ — one-time покупка `tier=book` (не тарифы Навигатор/Наставник/Мастер). План: `docs/04_workspace/book_reader_plan.md`. CDN upload: `docs/04_workspace/book_cdn_upload.md`.

## 2. Публичный контракт

Barrel `modules/book/index.ts`:

- **`BOOK_ID`** — `yoga_wizards_path`.
- **`bookLocaleForAppLocale(locale)`** — UI → `BookLocale` (8 локалей).
- **`resolveBookAccess(): Promise<boolean>`** — `GET /api/account/purchases/book` (`payment_contracts` one_time `tier=book` active). Опциональный Dev unlock (`EXPO_PUBLIC_BOOK_DEV_UNLOCK`) не обязателен: админ может выдать книгу через «Добавить платёж» → книга.
- **`BookProfileCard`** — карточка «Учебное пособие» + «Читать…».
- **`BookReaderScreen`** — lazy `app/book/[locale].tsx` (не в barrel).

### Ownership / CDN / progress (Phase B)

| Method | Path | Назначение |
|---|---|---|
| GET | `/api/account/purchases/book` | `{ owned, contractId?, purchasedAt? }` |
| GET | `/api/book/manifest?locale=` | `{ epubUrl, version, title, coverUrl, bookId }` (403 если не owned) |
| GET/PUT | `/api/book/progress` | синк locator; LWW по `updated_at` |

EPUB URL: `{BOOK_CDN_BASE_URL}/{locale}/book.epub` (на сервере папка `book/ru/…`).  
Клиент: CDN → disk cache (`cdn-v{BOOK_EPUB_VERSION}`); в development при отсутствии файла на CDN → Metro `/hz-book/{locale}.epub`.  
Прогресс: local FileSystem + remote `book_reading_progress` (merge по `updatedAt`).

## 3. Внутренняя архитектура

- Ридер: `@epubjs-react-native/core` + `useBookFileSystem` (legacy FS).
- Prefs: `book-reader/prefs.json`; progress local: `book-progress/`.
- Shared owned helper: `_legacy_web/app/api/account/bookOwnership.ts` (overview + purchases/book + book/*).

## 4. Конфигурация

- Vercel: `BOOK_CDN_BASE_URL`, `BOOK_EPUB_VERSION`.
- Client development unlock: `EXPO_PUBLIC_BOOK_DEV_UNLOCK` (только при `EXPO_PUBLIC_APP_ENV=development`).
- i18n: `book.*`, `gate.body.book`.

## 5. Ограничения

- ES/PT/NL EPUB на CDN — после перевода + upload (см. checklist).
- Закладки / LitRes 3D curl — не в scope.
- Store-билд без покупки всегда locked (нет `__DEV__`-автоunlock).
