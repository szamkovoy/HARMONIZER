---
id: 02_modules/webinars/dependencies
title: Webinars Dependencies
version: 1.1
updated: 2026-05-07
depends_on: [02_modules/subscription/spec]
code_refs: [modules/access/core/features.ts]
---

## 1. Зависит от (план)

- **`subscription`** — матрица `TIER_FEATURES` / `FEATURE_REQUIRED_TIER` для будущего гейта (`webinar_community` → `master`).
- **`infra`** — Supabase (таблица `announcements`, RPC), Vercel API, когда появится потребление.

## 2. От него зависят

Пока **ни один** модуль в коде не импортирует `webinars`. В `MAP.md` у `subscription` и `infra` перечислены как плановые потребители графа.

## 3. Контрактные точки риска

Смена имени **`webinar_community`** или правил тарифа без появления UI оставит «мёртвый» ключ; схема **`announcements.kind`** должна оставаться согласованной с будущим клиентом.
