---
id: 04_reference/test_mode
title: Dialog Test Mode (Time Intervals)
version: 1.3
updated: 2026-05-25
depends_on: [02_modules/assistant/spec]
code_refs: [_legacy_web/app/api/_utils/testMode.ts]
---

# Режим тестирования временных интервалов диалога

Env-флаги для отладки логики фаз без реальных пауз (только сервер `_legacy_web`, в клиент не пробрасываются):

| Переменная | Значение | Эффект |
|------------|----------|--------|
| `TEST_MODE_FAST_INTERVALS` | `1` | Сжимает anti-replan 4ч и resume TTL для reopen/sync. **Окно подытоживания и cleanup `planned_events` не ускоряются**: due-событие остаётся доступным реальные 36 часов после `expected_at`. **Внутри активного диалога** (POST с `conversationId`) TTL паузы между репликами — **реальные 2ч** (`sessionTtlMs`). **При возобновлении сессии** (GET sync после reopen приложения) — сжатый `sessionResumeTtlMs()` (~12 с при divisor 600), чтобы короткая пауза симулировала «прошло много времени» и начинался новый диалог. Начиная с delayed planning reconciliation этот же флаг сжимает и server-side idle-delay перед канонизацией pending planning-candidates: стандартные 10 минут превращаются примерно в 1 секунду при divisor `600`. |
| `TEST_MODE_TIME_DIVISOR` | число (дефолт `600`) | Делитель: `600` ≈ 1 час → 6 секунд |
| `TEST_MODE_FORCE_PHASE` | `morning` \| `day` \| `evening` | Принудительная фаза дня; вместе с `phase_time` подменяет `local_hour` и `time_of_day` в промпте (9 / 14 / 19). Для planning внутри POST сервер также использует representative local hour при разборе пользовательских time-phrase, чтобы фразы вроде `сегодня в 11.30` не уезжали на «завтра» только из-за реального позднего часа устройства. |
| `DEBUG_DIALOG_EXPORT` | `1` | Расширенная отладочная выгрузка диалога (блок `debug` в meta + `dialog_state_after` в GET) без включения сжатия интервалов |

**Боевой режим:** флаги не заданы или `TEST_MODE_FAST_INTERVALS` ≠ `'1'`. Поведение как до патча.

**Отключение:** удалить переменные из `_legacy_web/.env.local` (локально) или из Vercel Environment Variables (прод) и перезапустить / redeploy. Код чистить не нужно.

При старте Node-сервера с активным тестом в логах одна строка: `[TEST MODE] Time intervals scaled by 1/…`.

**Не включать на проде** без явной необходимости. См. закомментированные строки в корневом `.env.example`.
