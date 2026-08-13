---
id: 04_workspace/book_reader_plan
title: Book reader — full plan + freeze/resume
updated: 2026-08-11
status: phase_a_in_progress
---

# Book reader — план и инструкция для продолжения после модерации

> **Как возобновить:** пришли агенту этот файл целиком и скажи «модерация пройдена, продолжаем book reader с Phase B».
> Агент обязан перечитать этот документ + `docs/00_index/MAP.md` + триады `account_web`, `profile`, `i18n` перед любыми изменениями.

## 0. Красные линии (пока билд на модерации Apple/Google)

**ЗАПРЕЩЕНО без явного «модерация пройдена» от владельца:**

1. `npx vercel --prod` / любой деплой на production Vercel.
2. Применение миграций Supabase на **prod** (`db push`, `apply_migration`, MCP apply на боевой проект).
3. EAS / local build с профилем **`production`** (store).
4. Правки поведения существующих роутов `/api/account/*` (checkout, webhooks, overview, session, purchases/last, delete, ott).
5. Удаление/переименование колонок и ломка RLS на живых таблицах.

**МОЖНО в Phase A (сейчас):**

- Локальная конвертация Word → EPUB в `Book/`.
- Код клиента (`modules/book`, экран Expo Router, блок в Профиле).
- `npx expo start --dev-client` / пересборка **только** `development` profile.
- Локальный прогресс чтения (AsyncStorage).
- Dev-разблокировка книги для теста (`__DEV__`), без прод-API владения.

Если задача упирается в пункт из «запрещено» — **остановиться**, обновить §8 «Точка остановки», заморозить.

---

## 1. Продукт (канон)

| Решение | Канон |
|---|---|
| Доступ | Только one-time покупка `payment_contracts` (`product_kind=one_time`, `tier=book`, `status=active`). **Не** связано с тарифами Навигатор/Наставник/Мастер. |
| Гейт без покупки | Диалог как `AccountGateDialog` («Возможности учётной записи») + copy про отсутствие доступа к материалу и переход в ЛК. Комплаенс сторов: без «купить/цена» в приложении. |
| Точка входа | Профиль: под блоком личных данных (дата/время/место рождения), **над** блоками отчётов. Заголовок «Учебное пособие», комментарий про книгу «Йога — путь волшебника», кнопка «Читать…». |
| Языки книги | Старт: **RU**. Далее EN → DE → остальные из 8 локалей приложения. Выбор файла книги = UI-locale (exact), fallback RU. |
| Хранение EPUB (цел.) | HTTPS на zamkovoi.yoga (ISPManager), как кабинет. Клиент скачивает + кэширует. Phase A: локальный/бандловый файл для Dev Client. |
| Обложка | Отдельные `Book/cover_Ru.jpg`, `Book/cover_En.jpg` → EPUB metadata cover. **Не** первая страница body. |
| Прогресс | EPUB CFI / locator (не номер «страницы»). Phase A: document FileSystem JSON. Phase B: синк в БД между устройствами. |
| Ридер (v1) | Позиция + «Продолжить»; A−/A/A+ (4–5 размеров); 3–4 шрифта; межстрочный; поля; тема light/dark = палитра приложения; оглавление; прогресс главы/%; поиск; история «назад»; responsive images / figure.asana. Без заметок/выделений/закладок в v1, но схема прогресса их не блокирует. |
| Стек ридера | `@epubjs-react-native/core` (+ WebView; `react-native-webview` уже в проекте). |

Исходники: `Book/Book_Ru.docx`, `Book/Book_En.docx`, обложки `Book/cover_*.jpg`. Папка `import/` к книге не относится — приложению не нужна.

---

## 2. Архитектура целевого решения (не компромисс)

### 2.1 Модуль `modules/book/` (новый)

```
modules/book/
  index.ts
  core/
    bookIds.ts          # BOOK_SLUG = "yoga_wizards_path"; locale → asset/url
    bookAccess.ts       # hasActiveBookPurchase() → client API
    readingProgress.ts  # get/set local + remote merge
    readerPrefs.ts      # fontSize step, fontFamily, lineHeight, margins
  ui/
    BookProfileCard.tsx
    BookReaderScreen.tsx  # or app/book/[locale].tsx thin wrapper
    BookGate.tsx          # обёртка над AccountGateDialog / custom body
  epub/                 # optional helpers (CSS injection, theme)
```

Документация модуля (после появления кода): `docs/02_modules/book/{spec,dependencies,history}.md` + строка в `MAP.md`.

### 2.2 Зависимости

- **account_web** — владение книгой (контракт one_time book); кабинет уже продаёт.
- **profile** — карточка входа.
- **i18n** — `book.*`, `gate.body.book` (RU source → sync 8 локалей).
- **ui/theme** — light/dark ридера = `paletteScheme` из Профиля.
- **infra** — Storage/CDN URL; позже таблица прогресса.

### 2.3 БД (только Phase B, additive)

```sql
-- draft name; apply ONLY after moderation
create table public.book_reading_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null,              -- e.g. 'yoga_wizards_path'
  locale text not null,               -- 'ru'|'en'|...
  locator text not null,              -- EPUB CFI / epub.js location
  percent numeric(5,2),               -- optional UI hint 0..100
  chapter_label text,                 -- optional "Глава 4"
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id, locale)
);
-- RLS: user reads/writes own rows only
```

Задел под закладки/highlights позже: отдельные таблицы с FK на `(user_id, book_id, locale)`, **не** пихать JSON в `locator`.

### 2.4 API (только Phase B, **новые** роуты — не ломать старые)

| Method | Path | Назначение |
|---|---|---|
| GET | `/api/account/purchases/book` | `{ owned: boolean, contractId?, purchasedAt? }` — есть ли active one_time book |
| GET | `/api/book/manifest?locale=` | `{ epubUrl, version, title, coverUrl }` — signed/public HTTPS URL |
| GET/PUT | `/api/book/progress` | синк locator (Bearer) |

Клиент в Phase A вызывает ownership через **dev stub**; в Phase B переключается на `purchases/book` без смены UX.

### 2.5 Хостинг EPUB (Phase B)

- Путь на сервере (черновик): `https://zamkovoi.yoga/books/yoga_wizards_path/{locale}/v{N}/book.epub` + `cover.jpg`.
- Версия в manifest → клиент инвалидирует кэш при обновлении вёрстки.
- ISPManager upload вручную или rsync; не через Vercel body limits.

### 2.6 EPUB production pipeline

1. Word (автор) → структурированный HTML (главы, `figure.asana`, подписи).
2. CSS: reflow, img max-width 100%, center, figcaption; dark mode: фон/текст в ридере, **img без invert**.
3. Сборка EPUB 3 (pandoc / Calibre / скрипт `scripts/book-build-epub.mjs`).
4. QA на Dev Client: оглавление, поиск, CFI после смены шрифта, асаны, cover.
5. Выкладка на zamkovoi.yoga + bump version в manifest.

Типы изображений в контенте:

- `.chapter-hero` — крупная иллюстрация главы;
- inline img — санскрит/схемы в потоке;
- `figure.asana` — фото + figcaption + инструкция.

---

## 3. Фазы работ

### Phase A — сейчас (безопасно для store review) ← **ТЕКУЩАЯ**

1. Этот план-файл.
2. RU: `Book/Book_Ru.docx` + `cover_Ru.jpg` → `Book/build/ru/book.epub` (и при необходимости промежуточный HTML).
3. `modules/book` + экран ридера на epub.js/WebView.
4. Карточка в `app/(tabs)/profile.tsx`.
5. Prefs + progress в document FileSystem (ключ с userId + bookId + locale).
6. Гейт без покупки; для теста в `__DEV__` — явный unlock (не в store-билде).
7. i18n строки RU→fill остальных.
8. **Нет** Vercel prod, **нет** prod migrations, **нет** production EAS.

### Phase B — после модерации (включить «по-настоящему»)

1. Additive migration `book_reading_progress`.
2. Новые API: `purchases/book`, `book/manifest`, `book/progress`.
3. Деплой Vercel **только** с новыми файлами; регрессия smoke: login, cabinet OTT, checkout, webhooks не трогались.
4. Загрузка EPUB/cover на zamkovoi.yoga; клиент → manifest URL + disk cache (`expo-file-system`).
5. Убрать dev-unlock; ownership только с API.
6. Синк прогресса: local ↔ server (last-write-wins по `updated_at`).
7. Store-билд с ридером (если нужен новый native — обычно WebView уже есть).

### Phase C — языки и полировка

1. ~~EN EPUB из `Book_En.docx` + `cover_En.jpg`.~~ **Сделано 2026-08-13** (локально / Dev Client; UI `en` → EN файл). CDN/store — после Phase B.
2. ~~DE EPUB~~ **Сделано 2026-08-13**. ~~FR/IT/ES/PT/NL pipeline~~ **в работе 2026-08-13** (`scripts/book-translate.mjs` → Gemini 3.1 Pro из EN; assemble DOCX → `book-build-epub.mjs`). Обложки locale — подставить `cover_{Fr,It,Es,Pt,Nl}.jpg` и пересобрать EPUB.
3. TOC/search UX, шрифты, a11y.
4. Опционально: закладки/highlights (новые таблицы).

---

## 4. Ридер — UX-детали v1

- Старт: обложка / «Продолжить чтение» если есть locator.
- Toolbar: назад (history), оглавление (sheet, не отдельный stack-kill), поиск, Aa (размер/гарнитура/интервал/поля), тема следует приложению.
- Прогресс: «Глава N · XX%» + тонкая полоса; не «стр. 127 из 342» как главный UI.
- History stack внутри книги для внутренних ссылок и TOC→глава.

---

## 5. Комплаенс App Store / Google

- В приложении: нет цен и «купить книгу».
- Гейт: нейтральный текст + «Личный кабинет» (скрыт для `store_review_account` / kill-switch).
- Покупка только в веб-кабинете (уже реализовано).
- Ревьюеры с Master + скрытым кабинетом книгу не купят — карточка «Учебное пособие» допустима, гейт без кабинета = только «Закрыть».

---

## 6. Тест-план (минимум)

**Phase A (Dev Client):**

- [ ] Профиль показывает карточку.
- [ ] Без unlock → гейт с нужным copy.
- [ ] С unlock → ридер открывает RU EPUB.
- [ ] Смена размера шрифта не теряет CFI (переоткрытие ≈ то же место).
- [ ] Оглавление → глава → назад.
- [ ] Light/dark: текст/фон меняются, картинки асан читаемы.
- [ ] Поиск находит слово; прогресс % двигается.

**Phase B:**

- [ ] Реальный buyer: owned=true, ридер с CDN.
- [ ] Не-buyer: гейт.
- [ ] Прогресс на устройстве A → устройство B.
- [ ] Smoke: кабинет, подписка, вебинар, книга-покупка в кабинете.

---

## 7. Файлы / артефакты

| Путь | Назначение |
|---|---|
| `docs/04_workspace/book_reader_plan.md` | Этот план (source of truth для resume) |
| `Book/*.docx`, `Book/cover_*.jpg` | Авторские исходники |
| `Book/build/{locale}/book.epub` | Собранные EPUB (можно gitignore крупные бинарники) |
| `modules/book/**` | Клиентский модуль |
| `app/book/[locale].tsx` | Экран ридера (Expo Router) |
| `scripts/book-build-epub.mjs` | (опц.) воспроизводимая сборка |

---

## 8. Точка остановки / статус

**Status:** `phase_a_in_progress` (2026-08-11)

**Сделано:**

- Согласован безопасный контур (Dev Client, без prod deploy/migrations).
- Зафиксирован полный целевой план (этот файл).
- RU/EN EPUB: `node scripts/book-build-epub.mjs ru|en` → `Book/build/{locale}/book.epub` (+ copy в `assets/books/`, gitignored).
- Каркас `modules/book`, экран `app/book/[locale].tsx`, карточка в Профиле, local progress (FileSystem), prefs Aa, TOC sheet.
- Ownership Phase A: `__DEV__` → unlocked; production build → locked + `gate.body.book`.
- Пакеты: `@epubjs-react-native/core` (+ legacy FS-адаптер `modules/book/core/useBookFileSystem.ts`); `metro.config.js` assetExts `epub`.
- Фикс SDK 54: jszip write через `expo-file-system/legacy`; chrome без Stack header.
- Фикс cold-start: lazy `app/book/[locale]`, EPUB require только в `bookAssets.ts`, barrel без ридера.
- 2026-08-12: LitRes-like chrome, TOC fix, EPUB CSS/white page, prefs persist, vertical scroll; page-curl 3D — open (стек epub.js).
- 2026-08-12 (hard-fix): chrome toggle (parsed WebView msg), scrubber по locations, tap zones, prefs keep CFI, `patch-package` на GestureHandler для scrolled-doc, i18n Opening. Page-curl / slide-анимация тапа — **после модерации**.
- **Не** деплоили Vercel, **не** трогали prod migrations / store EAS.

**Dev Client perf note (2026-08-13):** Slow/stuck “Downloading …” after the book work: (1) Profile prefetch of reader — removed; (2) Metro Node crawler (Watchman often absent) walking `ios`/~1G, `dist`/~0.5G, `_legacy_web/.next`/~1.3G, `_legacy_web/node_modules`/~1G, ambient `raw`, `Book/`. Do **not** block all of `_legacy_web` (app imports `@shared` / `_legacy_web/app/api/_utils`). Fix: `.watchmanconfig` + metro `blockList` on those heavy subtrees only. Restart Metro after changing `metro.config.js` (no need for `-c` every time). Optional: `brew install watchman`.

**Следующий шаг Phase A (QA на Dev Client):**

1. `npx expo start --dev-client` (add `-c` only when needed) → Профиль → «Читать…»: chrome hide/show, left/right/center taps, scrubber drag, Aa без прыжка на обложку, vertical scroll без freeze, Opening на языке UI.
2. `node scripts/book-build-epub.mjs ru` — только если EPUB локально устарел.
3. Page-curl как в LitRes / анимация сдвига при тапе — после модерации (другая lib или native layer).
4. Production EAS / Vercel — только после «модерация пройдена».

**Phase B не начинать**, пока владелец не напишет, что модерация завершена.
