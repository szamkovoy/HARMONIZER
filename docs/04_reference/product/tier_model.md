# Модель тарифов

У продукта 4 тарифа: Free, Oracle, Practitioner, Master.

Free — бесплатный (общий прогноз, без персонализации).
Oracle — платный, базовый (натальный прогноз, калибровка, без ассистента).
Practitioner — платный (Oracle + ассистент + практики без асан).
Master — платный, полный (Practitioner + асаны + вебинары/community).

Trial = override на 3 дня → даёт уровень Master, не отдельный тариф.

## Терминология "free / premium"

В коде главной страницы и в текущем поле БД `users.membership_tier` встречается двойное деление `free / premium`. Это НЕ другая модель — это группировка для UI-логики главного экрана: `premium` в этом контексте означает «любой из трёх платных тарифов». Внутри premium различаются Oracle / Practitioner / Master.

## Текущее состояние реализации

Поле БД `users.membership_tier` пока хранит только `free/premium` с `trial`.
Полная модель (4 тарифа + feature gates через `canUseFeature`) пока не реализована. Это плановая работа.

Подробности и план перехода: `tmp_docs/02052026/access_tiers_navigation_brief.md`.
