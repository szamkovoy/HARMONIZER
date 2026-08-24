---
id: 02_modules/book/history
title: Book History
version: 1.0
updated: 2026-08-24
depends_on: [02_modules/book/spec]
code_refs: [modules/book/index.ts, docs/04_workspace/book_reader_plan.md]
---

## Decision Log

- **2026-08-24 (CDN folder rename):** На zamkovoi папка EPUB переименована `book/` → `ebook/` (чтобы не конфликтовать с WP-страницей `/book`). Vercel `BOOK_CDN_BASE_URL=https://zamkovoi.yoga/ebook` (prod/preview/dev). Страница продукта и кабинетный `BOOK_URL` остаются `https://zamkovoi.yoga/book`.

- **2026-08-15 (CDN complete):** ES/PT/NL залиты на zamkovoi (`/book/{es,pt,nl}/book.epub`). Vercel `BOOK_EPUB_VERSION=2` (prod/preview/dev) + prod redeploy — клиентский cache bust.

- **2026-08-15 (ES/PT/NL):** Перевод глав complete (`ALL COMPLETE`); собраны `book/build/{es,pt,nl}/book.epub` + DOCX; папка исходников переименована `Book` → `book` (scripts/metro/docs).

- **2026-08-14 (no DEV unlock):** Удалён `EXPO_PUBLIC_BOOK_DEV_UNLOCK`; доступ только через ownership API. Default reader font 16px.

- **2026-08-14 (admin grant):** Книгу удобнее выдавать из админки («Добавить платёж» → Книга → `payment_contracts`); Dev unlock env опционален.

- **2026-08-14 (CDN path simplify):** Публичные URL без `yoga_wizards_path` и без `/vN/`: `https://zamkovoi.yoga/book/{locale}/book.epub`. Версия только в `BOOK_EPUB_VERSION` (клиентский cache key).

- **2026-08-14 (Phase B):** Ownership API `purchases/book`; CDN manifest + versioned cache; `book_reading_progress` + LWW sync; Dev unlock только через `EXPO_PUBLIC_BOOK_DEV_UNLOCK` (не `__DEV__`); Metro fallback для незалитых локалей. Checklist: `docs/04_workspace/book_cdn_upload.md`.

- **2026-08-14 (finger-follow paginated):** Soft turn усилен: страница следует за пальцем при свайпе, порог commit / snap-back; tap zones — более длинный slide (не 28px «дёрганье»). По-прежнему не LitRes continuous gutter-scroll и не 3D curl.

- **2026-08-14 (soft paginated turn):** После модерации — лёгкий slide+fade при тапе/свайпе в paginated (не LitRes 3D curl; curl по-прежнему требует другой стек).

- **2026-08-13 (FR/IT/ES/PT/NL translation pipeline):** EN → chapter MD → Gemini `gemini-3.1-pro-preview` (`scripts/book-translate.mjs` + prompt) → DOCX/EPUB; `bookLocaleForAppLocale` covers all 8 UI locales; temp covers from `cover_En.jpg` until locale art lands.

- **2026-08-13 (DE EPUB):** `Book_De.docx` → `Book/build/de/book.epub`; UI `de` → DE через `/hz-book/de.epub` (без Metro asset). TOC strip: `inhaltsverzeichnis`.

- **2026-08-13 (no Metro EPUB assets):** Dev «Downloading 1%/min» + чёрный экран: телефон качает ~21MB JS, а крупные `require(epub)` в assets усугубляли Metro. Оба языка только `Book/build` + `/hz-book/{locale}.epub`; `bookAssetModule` → null. Watchman на машине отсутствовал (Node crawler).

- **2026-08-13 (EN without second asset):** Два EPUB в `assets/books` → Dev cold-start black screen. EN убран из Metro assets; отдаётся `Book/build/en/book.epub` через `/hz-book/en.epub` + `openBookSrc`. В бандле только RU.

- **2026-08-13 (EN EPUB + cold start):** Сборка EN EPUB; UI `en` → английская книга. Оба `require(epub)` в одном `bookAssets.ts` тянули RU+EN в async-чанк ридера → риск чёрного экрана после QR. Фикс: `bookAssetRu` / `bookAssetEn` + dynamic `import()` только нужной локали.

- **2026-08-13 (EN EPUB):** Сборка `Book_En.docx` → `Book/build/en/book.epub` + `assets/books/yoga-wizards-path-en.epub`. `bookAssetModule('en')` подключает файл; при UI-locale `en` в Профиле открывается английская книга. Пайплайн: strip Word TOC (RU/EN ids), promote Prologue в nav, cover `lang` = locale.

- **2026-08-13 (flow switch stick):** Смена scrolled↔paginated уводила текст: (1) `applyLiveAnchor` затирал start-% center-% середины страницы; (2) CFI как `initialLocation` между managers сажал не туда; (3) `section.find` брал первое вхождение фразы в главе. Фикс: после capture форсируем start-% + spine file; remount без CFI; restore = start-% → nearest snippet → CFI.

- **2026-08-13 (TOC part → wrong spine):** Клик «Часть III: Яма» открывал «Путь»/Пролог: кандидаты `#frag` резолвились в текущем spine; placeHeading брал первый h1 в чужом iframe. Фикс: только `file#frag`; nudge только по совпавшему id+file. Футер «Учебное пособие» на части — leaf-only TOC; теперь allToc + flatToc + sticky от клика.

- **2026-08-13 (TOC chrome offset + gray row):** Подсветка TOC — серый фон (light/dark), без bold/accent. Переход из оглавления: после `display` nudge заголовка на ~topBar+3 строки (`anchorOffsetPx`), иначе chrome перекрывает название; в paginated при залипании внизу — несколько next.

- **2026-08-13 (cover width + flow + TOC):** Scrolled cover была маркой по центру (`img width:auto !important`); full-width через setProperty important. Flow: href#→center-% уводил с начала «Эпилог» в середину — теперь snippet → start-% → href#. TOC: подсветка текущего + scrollTo mid-list.

- **2026-08-13 (cover in scrolled):** В vertical scroll обложки не было (в paginated была): continuous iframe считает высоту по контенту, а `body#cover` с `min-height:100%`/`100vh` схлопывался. Фикс: `buildEnsureCoverStageScript(readerH)` + theme/CSS `min-height:100vh`; нумерация страниц не трогалась (cover уже в spine).

- **2026-08-13 (paginated footer + flow jump):** Горизонтальный режим: «Падмасана» на экране, футер «Полезные ссылки» — multi-column: поздние главы с тем же Y справа; нужен X-intersection. Смена → scrolled уводила далеко: remount без initialLocation до locations → начало книги. Фикс: onPage по X; flow restore через href# + % retry (без snippet/CFI после успешного href#).

- **2026-08-13 (footer vs screen near EOF):** На экране «23. Падмасана», в футере «Полезные ссылки»: (1) `atEnd` форсил last-leaf до visible; (2) iframe-local `rect.top` у нижележащих секций. Фикс: visible→cfi→eof; screen coords через `frameElement`.

- **2026-08-13 (mid-viewport chapter + flow focus):** Футер в scrolled менял главу только когда заголовок доходил до ~top (≤140px) — на скрине гл.5 уже на экране, а подпись ещё «4.…». Фикс: reading line ≈48% высоты, скан всех contents. Смена paginated↔scrolled уводила фокус на много экранов: CFI continuous≠paginated; restore по % (+ skip initial CFI).

- **2026-08-13 (search freezes footer):** После поиска в scrolled футер залипал (гл.7 при тексте гл.3): `shouldAcceptAnchor` резал location=0 после jump при mid-book seed; sync не шёл. Фикс: accept при смене spine; forceAccept + clear toc/seed на search/TOC; sync всегда. (Ошибочный «фикс» сплэша через `expo-asset` откатан — он давал белый кадр без картинки.)

- **2026-08-13 (book open hang):** «Открываю книгу…» — `resolveBookSrc` отклонял здоровый кэш без `revision` и снова качал 7.5MB с Metro. Фикс: любой файл ≥500KB → hit + upgrade meta. Scrolled inset = `marginPx+6`.

- **2026-08-13 (same RN margins both flows):** Scrolled снова был уже paginated — body padding в continuous не держался. Одинаковый RN inset + clip-обёртка + `rendition.resize(w,h)` для обоих режимов.

- **2026-08-13 (Metro Downloading stuck):** Dev Client «Downloading» еле полз (Watchman не установлен → Node crawl). Корневые гиганты: `ios`~1G, `dist`~0.5G, `_legacy_web/.next`~1.3G + `node_modules`~1G, ambient `raw`, `Book/`. Фикс: metro `blockList` + `.watchmanconfig` на эти деревья (не весь `_legacy_web`). Код мандалы/аудио не менялся.

- **2026-08-13 (Watchman Book/):** После появления `Book/` (~50MB) crawl при `-c` стал долгим. `.watchmanconfig` ignore только `Book/` (Metro `blockList` на `Book/` уже был в Phase A).

- **2026-08-13 (no Profile prefetch):** Доп. тормоз — `BookProfileCard` → `prefetchBookReader()` (epub.js + EPUB). Prefetch убран; EPUB/epub.js тянутся только через lazy `app/book/[locale].tsx`.

- **2026-08-13 (EPUB cache vs Metro -c):** `resolveBookSrc` больше не ключует кэш на HTTP URI ассета Metro (после `-c` хэш менялся → лишний re-download 7.5MB). Ключ: `BOOK_EPUB_CACHE_REVISION` + size.

- **2026-08-13 (scrolled side padding):** После `100%` viewer текст в scrolled шёл к краям экрана (continuous игнорит узкий WebView). Paginated — по-прежнему RN inset; scrolled — `body` padding = `marginPx` на полной ширине WebView.

- **2026-08-13 (EOF chapter + scroll margins):** У конца книги футер залипал на асане 21 (stabilize резал переход Эпилог/Полезные ссылки при pct≈1); быстрый скролл залипал на чужой главе. Фикс: `tocSource` visible/eof/cfi; eof → последний leaf; stabilize только CFI same-file flash; sync чаще в scrolled. Отступы scrolled≠paginated из‑за `#viewer { width:100vw }` в WKWebView — `100%` + default `marginPx=16`.

- **2026-08-13 (footer chapters only + ch.13 flash):** Футер показывал «Часть…»/Практикум (parent TOC) и мигал «13.…» при скролле (CFI/visible id без leaf-фильтра + sticky seed). Фикс: `chapterTocItems` в chrome; capture только leaf TOC + contents iframe по `start.href`; `stabilizeTocHref` отбрасывает скачок главы при малом Δ%; sticky только валидные chapter labels.

- **2026-08-13 (continuous scroll + chapter fragment):** `scrolled-doc` крутил только один xhtml; вертикальный режим → `scrolled-continuous` + `manager=continuous` (remount). Подпись главы: много глав в `ch003.xhtml` — `tocHref` по id/CFI, не последний пункт TOC.

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
