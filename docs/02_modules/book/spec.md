---
id: 02_modules/book/spec
title: Book Spec
version: 1.0
updated: 2026-08-13
depends_on: [02_modules/profile/spec, 02_modules/i18n/spec, 02_modules/subscription/spec]
code_refs:
  [
    modules/book/index.ts,
    modules/book/core/bookIds.ts,
    modules/book/core/bookAccess.ts,
    modules/book/core/readingProgress.ts,
    modules/book/core/readerPrefs.ts,
    modules/book/core/liveAnchor.ts,
    modules/book/core/restoreLocation.ts,
    modules/book/core/coverStage.ts,
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
- **`bookLocaleForAppLocale(locale)`** — UI-locale → `BookLocale` (`ru` | `en` | `de` | `fr` | `it` | `es` | `pt` | `nl`); все 8 локалей приложения → свой EPUB (после сборки).
- **`resolveBookAccess(): Promise<boolean>`** — Phase A: `__DEV__` → `true`, иначе `false` (store-safe, без нового API).
- **`BookProfileCard`** — карточка «Учебное пособие» + кнопка «Читать…» (без prefetch ридера — иначе epub.js/EPUB тянутся при заходе в Профиль).
- **`BookReaderScreen`** — не в barrel; lazy `app/book/[locale].tsx` (Suspense). Chrome overlay + scrubber. Шрифт/размер — in-place + snippet-first restore. Смена scroll flow — remount + start-% (top-of-view) → nearest snippet in spine → CFI; `initialLocation` = spine file без `#` (CFI/`href#` между managers уводят фокус). Боковые поля (`marginPx`, default 16): одинаковый RN inset WebView в paginated и scrolled (+ clip + `rendition.resize(w,h)`). Вертикальный скролл — `scrolled-continuous` + `manager=continuous`; обложка в начале через `buildEnsureCoverStageScript` (px min-height — иначе iframe схлопывается). Футер: главы и «Часть…» (flat TOC); visible heading mid-viewport + горизонтальный hit-test; `tocSource` visible/cfi/eof. TOC navigate: только `file#frag` (без bare `#id`). Cover center; caption gap.

Маршрут: `app/book/[locale].tsx` → lazy `BookReaderScreen`.

## 3. Внутренняя архитектура

- EPUB (Phase A Dev): только `Book/build/{locale}/book.epub`, отдача Metro `GET /hz-book/{locale}.epub` → `openBookSrc`. **Нет** `require(*.epub)` в `assets/books` — иначе Dev Client зависает на Downloading % / чёрном экране.
- Metro: `assetExts` включает `epub`.
- Прогресс / prefs: `expo-file-system/legacy` (`book-progress/`, `book-reader/prefs.json`).
- Стек ридера: `@epubjs-react-native/core` + `useBookFileSystem` (legacy FS).
- EPUB: `resolveBookSrc` → `documentDirectory/books/{BOOK_ID}-{locale}.epub`.

## 4. Конфигурация и параметры

- i18n: `book.*`, `gate.body.book` (RU source → sync).
- Ownership API / CDN / remote progress — **не** в Phase A (см. план Phase B).

## 5. Известные ограничения

- Production/store билд всегда locked до Phase B API.
- Dev EPUB: все 8 локалей через `/hz-book/{locale}.epub` (`Book/build/…`). Литературный перевод FR/IT/ES/PT/NL — `scripts/book-translate.mjs` (Gemini 3.1 Pro) + `book-assemble-docx.mjs` + `book-build-epub.mjs`. Store/CDN — Phase B.
- Нет поиска, history-back, remote sync, CDN download в текущем коде.
- Крупный EPUB не в git — локально пересобрать перед Dev Client QA.
