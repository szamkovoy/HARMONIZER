---
id: 02_modules/book/history
title: Book History
version: 1.0
updated: 2026-08-12
depends_on: [02_modules/book/spec]
code_refs: [modules/book/index.ts, docs/04_workspace/book_reader_plan.md]
---

## Decision Log

- **2026-08-12 (font/scroll/blockquote):** Prefs restore prefers percentage + cancel token (less jump on font flip); vertical scroll remounts Reader (no `changeFlow` hang); blockquote rule +2px left; EPUB rebuild.

- **2026-08-12 (panels/scrub/cover/search):** Matching light-gray top+bottom chrome; scrub live page counter + WebView `cfiFromPercentage` on release; search as in-tree overlay (no RN Modal → no «◀ Камера»); drop extra Find button; cover.xhtml → `<img>` (SVG was blank in WebView).

- **2026-08-12 (chrome/search/scrub polish):** LitRes-like chrome iterations; scrub commit-on-release; prefs restore mid-page %; caption +3px under asana photos.

- **2026-08-12 (overlay chrome + gestures):** Toggle chrome менял height Reader → страница «прыгала»; теперь chrome overlay, размер WebView фиксирован. Paginated: свой PanResponder (тапы/свайп), `enableSwipe=false`. Cover center CSS.

- **2026-08-12 (reader UX hard-fix):** Chrome всегда виден — `onWebViewMessage` получает parsed object, не `nativeEvent`; scrubber брал chapter-local `progress` (~1.0) → ratio от `location/(total-1)` + PanResponder; смена шрифта/темы сбрасывала на обложку — `applyPrefsKeepLocation` + restore CFI; зоны тапа left/center/right; vertical scroll freeze — patch `GestureHandler` when `!enableSwipe`; i18n `book.reader.opening`. Page-curl как в LitRes — отложено после модерации.

- **2026-08-12 (reader gestures/safe-area):** Disable stack pop gesture on `book/[locale]` (swipe-right was leaving reader); reserve safe-area + chrome height so text isn’t under notch/panels; title_page `linear=no` (empty page); TOC via multi-candidate `display()`; chrome toggle via WebView click bridge (RNGH taps unreliable over WebView).

- **2026-08-12 (LitRes-like chrome + fixes):** TOC navigate via safe `rendition.display(JSON)`; EPUB rebuild strips Word-TOC / nav not in linear spine; white page + italic blockquotes; Aa sheet +/− size/line/margins + vertical scroll; tap chrome (X/search/settings/TOC + bottom progress); prefs/progress on `expo-file-system/legacy`. True finger page-curl like LitRes недоступен в epub.js без смены стека — paginated+snap / scrolled-doc.

- **2026-08-11 (cold-start hang):** Sync import of `BookReaderScreen` / EPUB via barrel + `app/book/[locale]` тянул epub.js (~тяжёлый) и 14MB asset в стартовый граф → чёрный экран. Фикс: lazy route, `bookAssets` отдельно от `bookIds`, barrel без ридера.

- **2026-08-11 (SDK 54 FileSystem + chrome):** Stock `@epubjs-react-native/expo-file-system` ломается на Expo 54 (`writeAsStringAsync` из main entry бросает → `failed to write jszip js file`). Свой адаптер `useBookFileSystem` на `expo-file-system/legacy`; EPUB материализуется в `documentDirectory/books/*.epub`. Скрыт Stack header; тулбар/тема ридера в палитре приложения.

- **2026-08-11 (Phase A scaffold):** Новый модуль `modules/book` + маршрут `app/book/[locale].tsx` + карточка в Профиле. Ридер на `@epubjs-react-native/core`; прогресс/prefs в `expo-file-system` (document). Ownership: `__DEV__` unlock / production locked. План и freeze-протокол: `docs/04_workspace/book_reader_plan.md`. Без Vercel prod, без prod migrations, без production EAS.
