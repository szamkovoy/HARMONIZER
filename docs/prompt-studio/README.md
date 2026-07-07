# Prompt Studio (временный стенд)

Стенд для быстрой шлифовки промпта «Рекомендаций на день» без пересборки приложения.

## Что это

- **HTML:** `wordpress-snippet.html` — вставить в Custom HTML block на https://zamkovoy.yoga
- **API:** `_legacy_web/app/api/ai/prompt-studio/route.ts` — GET/PATCH/POST на Vercel

Генерация использует тот же `generateGeminiJson`, `getModelByHint`, `renderPrompt`, baseline states и `author_voice_block`, что и боевой путь `morning_recommendation`.

## Настройка (один раз)

1. Задать секрет на Vercel:
   ```bash
   cd /Users/sergey/Desktop/HARMONIZER
   npx vercel env add PROMPT_STUDIO_TOKEN production
   ```
   (ввести длинный случайный токен)

2. Задеплоить `_legacy_web` на Vercel (из корня репозитория).

3. На странице WordPress вставить содержимое `wordpress-snippet.html`, в поле «Токен» ввести тот же `PROMPT_STUDIO_TOKEN`.

## Использование

1. **Загрузить промпт** — подтягивает активный шаблон из `public.prompts`.
2. Редактировать текст в textarea.
3. **Сохранить промпт** — обновляет `template` активной строки in-place (без новой версии).
4. Настроить три планеты и гармоничность; для главной — транзит и аспект.
5. **Вывести рекомендацию** — отправляет **текущий текст из textarea** (можно тестировать без сохранения) + данные формы в LLM.

Значения формы держатся в браузере, пока открыта вкладка; в БД сохраняется только промпт по кнопке «Сохранить».

## Удаление после итераций

1. Удалить страницу на zamkovoy.yoga.
2. Удалить `_legacy_web/app/api/ai/prompt-studio/`.
3. Убрать `PROMPT_STUDIO_TOKEN` из Vercel env.
4. Удалить `docs/prompt-studio/`.
