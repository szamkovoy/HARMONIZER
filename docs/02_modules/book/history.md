---
id: 02_modules/book/history
title: Book History
version: 1.0
updated: 2026-08-12
depends_on: [02_modules/book/spec]
code_refs: [modules/book/index.ts, docs/04_workspace/book_reader_plan.md]
---

## Decision Log

- **2026-08-13 (margins RN + scroll changeFlow):** Отступы внутри EPUB резали текст слева при 24px — теперь inset ширины WebView (`paddingHorizontal` + `readerW`). Скролл: без remount (`changeFlow` in-place); patch template — await `locations.generate` + safe `percentageFromCfi` (Opening hang).

- **2026-08-13 (margins + scroll Opening hang):** Боковые отступы не работали — book CSS `padding: 0.6em 0` обнулял горизонталь; фикс `!important` + inject в contents. Вертикальный скролл вечно «Открываю…»: `waitForLocationsReady=false` → Opening ждёт `onReady`, а тот падает на `percentageFromCfi` до generate; теперь always wait for locations.

- **2026-08-13 (in-place font + zeroish page fix):** Remount на смену шрифта уводил назад; футер «1 из 168» из `location=0`/`percent=0`, перебивавших seed. Фикс: appearance через `changeTheme`/`changeFont*` без remount + snippet-first restore; page/scrubber предпочитают seed над zeroish; не persist’ить flash 0%; remount только для scrollMode.

- **2026-08-12 (text snippet + chrome seed):** Смена шрифта всё ещё уводила на соседний абзац (CFI смещается при reflow); футер «Полезные ссылки / 1 из 168» из flash `location=0` + library `section`. Фикс: snippet в progress/restore (`section.find`), reject start-flash while restoring, seed percent/label, Suspense+prefetch reader chunk (минута без текста = lazy epub.js).

- **2026-08-12 (live anchor / focus keep):** После TOC/`goNext` RN `section`/`currentLocation` иногда отстают от WebView → футер «гл. 2 / 151 из 168» на послесловии и прыжок назад при смене шрифта. Фикс: `CAPTURE_LIVE_ANCHOR_JS` + `hzAnchor` перед remount; глава через `tocLabelForHref`; sync после TOC/тапа/scrub.

- **2026-08-12 (font remount):** Font/size/margins remount Reader with saved CFI (`initialLocation` + retry display); in-place changeFont* abandoned (multi-page jumps).

- **2026-08-12 (perf/pages/media):** Dev EPUB disk cache (stop re-download every open); build compresses media (~14MB→~7.5MB); page label clamps EOF (`169 из 168`).

- **2026-08-12 (font/scroll/blockquote):** Vertical scroll remounts Reader (no `changeFlow` hang); blockquote rule +2px left.

- **2026-08-12 (panels/scrub/cover/search):** Matching light-gray top+bottom chrome; scrub live page counter + WebView `cfiFromPercentage` on release; search as in-tree overlay (no RN Modal → no «◀ Камера»); drop extra Find button; cover.xhtml → `<img>` (SVG was blank in WebView).

- **2026-08-12 (chrome/search/scrub polish):** LitRes-like chrome iterations; scrub commit-on-release; prefs restore mid-page %; caption +3px under asana photos.

- **2026-08-12 (overlay chrome + gestures):** Toggle chrome менял height Reader → страница «прыгала»; теперь chrome overlay, размер WebView фиксирован. Paginated: свой PanResponder (тапы/свайп), `enableSwipe=false`. Cover center CSS.

- **2026-08-12 (reader UX hard-fix):** Chrome всегда виден — `onWebViewMessage` получает parsed object, не `nativeEvent`; scrubber брал chapter-local `progress` (~1.0) → ratio от `location/(total-1)` + PanResponder; смена шрифта/темы сбрасывала на обложку — `applyPrefsKeepLocation` + restore CFI; зоны тапа left/center/right; vertical scroll freeze — patch `GestureHandler` when `!enableSwipe`; i18n `book.reader.opening`. Page-curl как в LitRes — отложено после модерации.

- **2026-08-12 (reader gestures/safe-area):** Disable stack pop gesture on `book/[locale]` (swipe-right was leaving reader); reserve safe-area + chrome height so text isn’t under notch/panels; title_page `linear=no` (empty page); TOC via multi-candidate `display()`; chrome toggle via WebView click bridge (RNGH taps unreliable over WebView).

- **2026-08-12 (LitRes-like chrome + fixes):** TOC navigate via safe `rendition.display(JSON)`; EPUB rebuild strips Word-TOC / nav not in linear spine; white page + italic blockquotes; Aa sheet +/− size/line/margins + vertical scroll; tap chrome (X/search/settings/TOC + bottom progress); prefs/progress on `expo-file-system/legacy`. True finger page-curl like LitRes недоступен в epub.js без смены стека — paginated+snap / scrolled-doc.

- **2026-08-11 (cold-start hang):** Sync import of `BookReaderScreen` / EPUB via barrel + `app/book/[locale]` тянул epub.js (~тяжёлый) и 14MB asset в стартовый граф → чёрный экран. Фикс: lazy route, `bookAssets` отдельно от `bookIds`, barrel без ридера.

- **2026-08-11 (SDK 54 FileSystem + chrome):** Stock `@epubjs-react-native/expo-file-system` ломается на Expo 54 (`writeAsStringAsync` из main entry бросает → `failed to write jszip js file`). Свой адаптер `useBookFileSystem` на `expo-file-system/legacy`; EPUB материализуется в `documentDirectory/books/*.epub`. Скрыт Stack header; тулбар/тема ридера в палитре приложения.

- **2026-08-11 (Phase A scaffold):** Новый модуль `modules/book` + маршрут `app/book/[locale].tsx` + карточка в Профиле. Ридер на `@epubjs-react-native/core`; прогресс/prefs в `expo-file-system` (document). Ownership: `__DEV__` unlock / production locked. План и freeze-протокол: `docs/04_workspace/book_reader_plan.md`. Без Vercel prod, без prod migrations, без production EAS.
