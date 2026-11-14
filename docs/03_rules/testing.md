---
id: 03_rules/testing
title: Testing
version: 1.1
updated: 2026-11-14
depends_on: [01_foundation/runtime_modes]
code_refs: [docs/testing-mode.md, docs/user-diagnostic-json-reception.md]
---

## Как запускать

- `npm test` — весь vitest (`npx vitest run`).
- `npm run test:book` — три файла книги на `node:test`, через `tsx --test`:
  `modules/book/core/flattenToc.test.ts`, `liveAnchor.test.ts`, `tocNavigate.test.ts`.
  Vitest их не собирает: у них нет наборов vitest, а `node --test` без tsx не резолвит импорты `.ts` без расширения.

## TODO: наполнить на этапе миграции.

Здесь будут правила smoke/manual/automated testing, диагностики и проверок перед изменениями.
Файл станет общей точкой для тестовых практик проекта.
