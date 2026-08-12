---
id: 02_modules/book/spec
title: Book Spec
version: 1.0
updated: 2026-08-12
depends_on: [02_modules/profile/spec, 02_modules/i18n/spec, 02_modules/subscription/spec]
code_refs:
  [
    modules/book/index.ts,
    modules/book/core/bookIds.ts,
    modules/book/core/bookAccess.ts,
    modules/book/core/readingProgress.ts,
    modules/book/core/readerPrefs.ts,
    modules/book/ui/BookProfileCard.tsx,
    modules/book/ui/BookReaderScreen.tsx,
    app/book/[locale].tsx,
    app/(tabs)/profile.tsx,
    scripts/book-build-epub.mjs,
    docs/04_workspace/book_reader_plan.md,
  ]
---

# Book

## 1. Назначение

Клиентский модуль **учебного пособия** («Йога — путь волшебника»): карточка в Профиле, гейт доступа и EPUB-ридер (epub.js / WebView). Доступ к материалу — отдельная one-time покупка `tier=book` (не тарифы Навигатор/Наставник/Мастер). Полный целевой план и фазы — `docs/04_workspace/book_reader_plan.md`.

## 2. Публичный контракт

Barrel `modules/book/index.ts`:

- **`BOOK_ID`** — канонический id книги (`yoga_wizards_path`).
- **`bookLocaleForAppLocale(locale)`** — UI-locale → `BookLocale` (`ru` | `en`); Phase A: всё кроме `en` → `ru`.
- **`resolveBookAccess(): Promise<boolean>`** — Phase A: `__DEV__` → `true`, иначе `false` (store-safe, без нового API).
- **`BookProfileCard`** — карточка «Учебное пособие» + кнопка «Читать…».
- **`BookReaderScreen`** — не в barrel; lazy `app/book/[locale].tsx`. Chrome overlay: сверху прозрачный toolkit (иконки), снизу непрозрачная серая панель + scrubber (commit on release). Поиск — fullScreen. Prefs restore mid-page % (`restoreLocation.ts`). Cover center; caption gap under photos.

Маршрут: `app/book/[locale].tsx` → lazy `BookReaderScreen`.

## 3. Внутренняя архитектура

- Asset: бандловый `assets/books/yoga-wizards-path-ru.epub` (gitignore; сборка `node scripts/book-build-epub.mjs ru` + `Book/epub-reader.css`).
- Metro: `assetExts` включает `epub`.
- Прогресс / prefs: `expo-file-system/legacy` (`book-progress/`, `book-reader/prefs.json`).
- Стек ридера: `@epubjs-react-native/core` + `useBookFileSystem` (legacy FS).
- EPUB: `resolveBookSrc` → `documentDirectory/books/{BOOK_ID}-{locale}.epub`.

## 4. Конфигурация и параметры

- i18n: `book.*`, `gate.body.book` (RU source → sync).
- Ownership API / CDN / remote progress — **не** в Phase A (см. план Phase B).

## 5. Известные ограничения

- Production/store билд всегда locked до Phase B API.
- Только RU EPUB в бандле; EN/DE — Phase C.
- Нет поиска, history-back, remote sync, CDN download в текущем коде.
- Крупный EPUB не в git — локально пересобрать перед Dev Client QA.
