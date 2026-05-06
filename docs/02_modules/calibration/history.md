---
id: 02_modules/calibration/history
title: Calibration History
version: 1.1
updated: 2026-05-06
depends_on: [01_foundation/architecture, 02_modules/profile/spec, 02_modules/communicator/spec, 02_modules/assistant/spec, 02_modules/infra/spec]
code_refs: [app/calibration.tsx, _legacy_web/app/api/calibration/extract/route.ts, _legacy_web/app/api/calibration/extract/forecast-cache-date.ts, _legacy_web/app/api/calibration/transcribe/route.ts, _legacy_web/app/api/_utils/calibration.ts, supabase/functions/auto-calibrate/index.ts, supabase/functions/auto-calibrate/proposal.ts, services/communicator-client.ts]
---

## Decision Log

- **Не датировано (источник `docs/05_archive/migrated/calibration/MODULE_3_Calibration_TZ.md`):** Зафиксировано разделение **states_map** (семантические маркеры по планетам/чакрам) и **user_lexicon** (речевые паттерны пользователя); оба поля пишутся из extract и читаются ассистентом для тона и контекста. ТЗ предполагало транскрипцию через `/api/calibration/transcribe`; **в текущем приложении** экран `app/calibration.tsx` использует **`/api/communicator/v2/transcribe`**, а маршрут `calibration/transcribe` остаётся отдельным серверным entry point — расхождение зафиксировано в каноне по коду клиента.

- **Не датировано (источник `docs/05_archive/migrated/calibration/PATCH_1_M3_averaging_ratio.md`):** Усреднение S/H переведено с равных весов на взвешенное по `source`: `initial` и `manual_resync` — **60%** натал / **40%** предложение LLM; `auto_aggregated` — **50/50** (`AVERAGING_WEIGHTS` в `_utils/calibration.ts`, проброс `source` в `extract/route.ts`). Старое описание в `calibration_and_orchestrator.md` («делить на два») **не соответствует** текущей реализации.

- **Не датировано (источник `docs/05_archive/migrated/calibration/PATCH_6_proposal_pending_fix.md` + код `proposal.ts`):** Исправлена семантика «вечного pending» для `preferences.autoCalibrationProposal`: при отсутствии `expiresAt` используется fallback по `createdAt`/`suggestedAt` + `FALLBACK_TTL_DAYS` (`30`); при полном отсутствии дат pending не блокирует cron (с предупреждением в лог). Добавлен cooldown после `rejected` (`REJECTED_COOLDOWN_DAYS` = `30`). Новые предложения получают `expiresAt` через `PROPOSAL_TTL_DAYS` (`14`).

- **2026-05:** Миграция документации модуля: канон собран по `app/calibration.tsx`, `api/calibration/*`, `_utils/calibration.ts`, `supabase/functions/auto-calibrate/*`. Источники `calibration_and_orchestrator.md`, `MODULE_3_Calibration_TZ.md`, PATCH 1/6 и датасет `chakra_states_baseline.json.txt` перенесены в `docs/05_archive/migrated/calibration/` и `docs/05_archive/research_assets/calibration/`; в рантайме baseline берётся из `_legacy_web/data/chakra_states_baseline.json`, а не из архивного `.txt`.
