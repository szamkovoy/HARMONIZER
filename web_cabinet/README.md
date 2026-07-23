# Статика для zamkovoi.yoga (ISPManager)

Единый корень деплоя. Две симметричные папки страниц + один файл Android-плеера.

| Путь в репо | Куда на сайте |
| --- | --- |
| `cabinet/` (`index.html` + `icons/` + `README.md`) | `https://zamkovoi.yoga/cabinet/` |
| `tv/` (`index.html` + `icons/` + `README.md`) | `https://zamkovoi.yoga/tv/` |
| `asana-embed.html` | `https://zamkovoi.yoga/asana-embed.html` |

**`asana-embed.html`** — не мусор: страница для Android WebView асан (Vimeo с Referer `zamkovoi.yoga`). URL плоский (`/asana-embed.html`), поэтому файл лежит в корне `web_cabinet/`, не в подпапке.

Документация логики Remote Play (Supabase, пульт в приложении): `docs/remote-play/README.md`.
