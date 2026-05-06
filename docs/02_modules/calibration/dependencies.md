---
id: 02_modules/calibration/dependencies
title: Calibration Dependencies
version: 1.2
updated: 2026-05-07
depends_on: [01_foundation/architecture, 02_modules/profile/spec, 02_modules/astro/spec, 02_modules/communicator/spec, 02_modules/assistant/spec, 02_modules/infra/spec]
code_refs: [app/calibration.tsx, _legacy_web/app/api/calibration/extract/route.ts, _legacy_web/app/api/calibration/extract/forecast-cache-date.ts, _legacy_web/app/api/calibration/transcribe/route.ts, _legacy_web/app/api/_utils/calibration.ts, _legacy_web/app/api/_utils/astro-db.ts, supabase/functions/auto-calibrate/index.ts, supabase/functions/auto-calibrate/proposal.ts, services/communicator-client.ts]
---

## 1. Зависит от

- **`profile`**  
  `extract/route.ts` вызывает `loadActiveNatalProfile(db, userId)` и `getUserTimezone(db, userId)` (натал для расчёта и tz для среза кэша). Без активного натального профиля сценарий extract не сойдётся с продуктовым контрактом.

- **`astro`**  
  Тот же `loadActiveNatalProfile` возвращает `NatalProfile`; `_legacy_web/app/api/_utils/calibration.ts` (`averageCalibration`) для каждой планеты берёт `natalProfile.planets[planet].S_initial` и `H_initial` как базу для взвешенного смешивания с дельтами извлечения (`AVERAGING_WEIGHTS`). Поля `S_initial`/`H_initial` в таблице `user_natal_charts` не перезаписываются калибровкой.

- **`communicator`**  
  `app/calibration.tsx` импортирует `mimeFromRecordingUri`, `whisperRecordingOptions` из `modules/communicator/core/*` и `transcribeCommunicatorAudio` из `services/communicator-client.ts`, который бьёт в `getCommunicatorV2TranscribeUrl()` (`/api/communicator/v2/transcribe`). Это единственный путь голоса для экрана калибровки.

- **`assistant`**  
  Косвенно: `auto-calibrate/index.ts` читает `conversations` / `messages` после `last_calibration_date` — это тот же домен данных, что наполняет диалог ассистента. Сама калибровка не импортирует серверный код assistant, но предложение `autoCalibrationProposal` рассчитано на последующий UX принятия в продуктовом потоке assistant.

- **`infra`**  
  Next.js API под Vercel (`runtime = "nodejs"` для маршрутов calibration), Edge Function на Supabase, секреты cron/Gemini, `reportRouteError` / мониторинг в `extract`, логирование размеров промпта в `user_event_log`.

## 2. От него зависят

- **`assistant`**  
  `_legacy_web/app/api/communicator/v2/dialog/route.ts` и `v2/greeting/route.ts` параллельно загружают строку `user_calibrations` (версия, `states_map`, `user_lexicon`, S/H, дата) и передают её в компактные DTO ответчика и оркестратора. Режим `useCase: "calibration"` завязан на фазы калибровочного диалога. Изменение формы `states_map` / лексикона — контрактный риск для промптов и сценариев assistant.

- **`daily_forecast` (данные, не отдельная строка MAP)**  
  После успешного extract удаляются строки `user_daily_forecasts` с `forecast_date >= todayLocalDate(userTz)` — кэш главного экрана должен пересобраться на новой калибровке.

## 3. Контрактные точки риска

- **Схема `user_calibrations` и JSON полей** (`s_calibrated`, `h_calibrated`, `states_map`, `user_lexicon`, `raw_feedback`) — любое изменение влияет на dialog DTO и на клиентов, читающих калибровку.
- **`CalibrationSource` и `AVERAGING_WEIGHTS`** — меняют числовой итог и должны оставаться согласованы с валидацией `assertSource` и с вызывающими `source` (в т.ч. будущий accept auto-proposal).
- **`autoCalibrationProposal` в `user_settings.preferences`** — форма объекта и поля `expiresAt` / `createdAt` / `suggestedAt` критичны для `isPendingProposal` и `isRejectedRecently`; сломанные записи раньше блокировали cron (см. decision log).
- **`forecast-cache-date` как shared-модуль** — импортируется из `astro/natal`, `astro/daily-forecast`, `scenarioCache`, `devDayContentReset`; правка сигнатур затронет несколько маршрутов вне calibration.
- **Промпт-ключ `calibration_extraction`** — переименование или смена плейсхолдеров ломает `renderPrompt` в extract.
- **Пороги auto-calibrate** (`MIN_DAYS_BETWEEN_CALIBRATIONS`, `MIN_USER_MESSAGES`, пороги дайджеста `3` / `0.45`) — продуктовая чувствительность частоты предложений.
