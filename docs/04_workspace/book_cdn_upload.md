# Book CDN upload checklist (Phase B)

Заливка EPUB на **zamkovoi.yoga** через ISPManager (не Vercel).
После заливки приложение читает URL из `GET /api/book/manifest`
(`BOOK_CDN_BASE_URL` + `BOOK_EPUB_VERSION` на Vercel).

## Структура папок (простая)

На сервере:

```text
/ebook/ru/book.epub
/ebook/en/book.epub
/ebook/de/book.epub
/ebook/fr/book.epub
/ebook/it/book.epub
/ebook/es/book.epub
/ebook/pt/book.epub
/ebook/nl/book.epub
```

Источник на Mac: **только** `book/build/{locale}/book.epub`  
(папка исходников — `book/`, lowercase; не `yoga-wizards-path-*.epub`).  
Публичные URL: `https://zamkovoi.yoga/ebook/{locale}/book.epub`  
(папка CDN — `ebook/`, чтобы не конфликтовать с WP-страницей `/book`).

Опционально в той же папке локали: `cover.jpg`.

## Проверка

1. Открыть URL в браузере → скачивание/EPUB, **не** HTML WordPress.
2. В приложении (купленная книга / админский грант): Профиль → Читать.
3. Сменить язык приложения на ES / PT / NL — должна открыться соответствующая локаль.

## Обновление контента

1. Пересобрать `node scripts/book-build-epub.mjs {locale}`.
2. Заменить `book.epub` в `/ebook/{locale}/` на сервере.
3. На Vercel bump `BOOK_EPUB_VERSION` (1→2…) во всех env → redeploy — клиентский кэш сбросится (`cdn-v{version}`).

## Dev без CDN

Пока locale нет на сервере, development падает обратно на Metro
`/hz-book/{locale}.epub` из `book/build/…` (нужен `npx expo start --dev-client`).
