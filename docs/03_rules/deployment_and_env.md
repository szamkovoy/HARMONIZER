---
id: 03_rules/deployment_and_env
title: Deployment And Env
version: 1.1
updated: 2026-11-14
depends_on: [01_foundation/tech_stack, 02_modules/infra/spec]
code_refs: [DEPLOY.md, .vercelignore, supabase/README.md]
---

## Регион серверных функций

Node-функции Next выполняются в **`dub1`** (Дублин). Это ключ `regions` в `_legacy_web/vercel.json`. База Supabase проекта `harmonizer` — `eu-west-1`, тот же Дублин.

В панели Vercel `serverlessFunctionRegion` и `functionDefaultRegions` остаются `iad1`. Пока в `vercel.json` указан `regions`, деплой использует его: у production после 2026-11-14 в `x-vercel-id` регион функции — `dub1`.

`runtime = "edge"` этот ключ не переносит. Таких маршрута два, своего `preferredRegion` нет:

- `GET /api/email/asset`
- `GET /api/email/track/open`

Остальной чеклист env и деплоя — в `DEPLOY.md`.
