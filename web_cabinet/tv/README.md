# Remote Play (ТВ) → `https://zamkovoi.yoga/tv/`

## Деплой (ISPManager)

1. Снять с публикации / удалить WordPress-страницу `/tv/` (иначе rewrite WP перехватит URL).
2. Залить содержимое этой папки в `public_html/tv/`:
   - `index.html`
   - `icons/`

## Проверка

- `https://zamkovoi.yoga/tv/` — русский UI (дефолт)
- `https://zamkovoi.yoga/tv/?fr` — французский («Création du code…»)

Ссылки в приложении: `modules/remote-play/core/tvPageUrl.ts` (`?pt`, `?fr`, …).  
Логика сессий / пульта: `docs/remote-play/README.md`.
