---
id: 04_reference/test_mode
title: Dialog Test Mode (Time Intervals)
version: 1.0
updated: 2026-05-21
depends_on: [02_modules/assistant/spec]
code_refs: [_legacy_web/app/api/_utils/testMode.ts]
---

# Режим тестирования временных интервалов диалога

Env-флаги для отладки логики фаз без реальных пауз (только сервер `_legacy_web`, в клиент не пробрасываются):

| Переменная | Значение | Эффект |
|------------|----------|--------|
| `TEST_MODE_FAST_INTERVALS` | `1` | Сжимает пороги: anti-replan 4ч, окно подытоживания 36ч, TTL conversation 2ч |
| `TEST_MODE_TIME_DIVISOR` | число (дефолт `600`) | Делитель: `600` ≈ 1 час → 6 секунд |
| `TEST_MODE_FORCE_PHASE` | `morning` \| `day` \| `evening` | Принудительная фаза дня; `local_hour` остаётся реальным |

**Боевой режим:** флаги не заданы или `TEST_MODE_FAST_INTERVALS` ≠ `'1'`. Поведение как до патча.

**Отключение:** удалить переменные из `_legacy_web/.env.local` (локально) или из Vercel Environment Variables (прод) и перезапустить / redeploy. Код чистить не нужно.

При старте Node-сервера с активным тестом в логах одна строка: `[TEST MODE] Time intervals scaled by 1/…`.

**Не включать на проде** без явной необходимости. См. закомментированные строки в корневом `.env.example`.
