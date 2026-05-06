---
id: 02_modules/calibration/spec
title: Calibration Spec
version: 1.1
updated: 2026-05-06
depends_on: [01_foundation/architecture, 02_modules/profile/spec, 02_modules/communicator/spec, 02_modules/assistant/spec, 02_modules/infra/spec]
code_refs: [app/calibration.tsx, _legacy_web/app/api/calibration/extract/route.ts, _legacy_web/app/api/calibration/extract/forecast-cache-date.ts, _legacy_web/app/api/calibration/transcribe/route.ts, _legacy_web/app/api/_utils/calibration.ts, supabase/functions/auto-calibrate/index.ts, supabase/functions/auto-calibrate/proposal.ts, services/communicator-client.ts]
---

## 1. Назначение

Модуль **calibration** держит цикл «обратная связь пользователя → числовая и семантическая подстройка натального контура»: голос или текст превращаются в структурированное извлечение дельт и словаря, затем в новую активную строку `user_calibrations` (силы/гармоничность планет, `states_map`, `user_lexicon`). Отдельный контур **auto-calibrate** по расписанию предлагает повторную калибровку на основе накопленных сообщений диалога, не применяя её без явного согласия пользователя.

## 2. Публичный контракт

### Клиент (Expo)

- Экран по умолчанию из `app/calibration.tsx` (маршрут `calibration`): фазы `idle` | `recording` | `transcribing` | `editing` | `extracting` | `complete` | `error`; запись через `expo-av` и `whisperRecordingOptions()`; минимальная длительность голоса `MIN_VOICE_MS` (`450`); порог низкой уверенности транскрипта `LOW_TRANSCRIPTION_CONFIDENCE` (`0.65`).
- `extractCalibration(req: CalibrationExtractRequest, signal?: AbortSignal): Promise<CalibrationExtractResponse>` в `services/communicator-client.ts`  
  `POST` на `getCalibrationExtractUrl()` → `/api/calibration/extract`, тело JSON: `source?`, `feedbackText?`, `conversationDigest?`, `language?` (см. сервер).
- `transcribeCommunicatorAudio(req: TranscribeAudioRequest): Promise<TranscribeAudioResponse>` — этот экран вызывает **общий** путь транскрипции: `POST` `/api/communicator/v2/transcribe` (не `/api/calibration/transcribe`).

### HTTP: `POST /api/calibration/extract`

- Авторизация: Supabase JWT через `requireUserId`.
- Тело (`ExtractBody`): `source`: `"initial"` | `"manual_resync"` | `"auto_aggregated"` (обязателен); для любого `source` кроме `"auto_aggregated"` нужен непустой `feedbackText` **или** в не-production допускается `debugExtraction`; для `"auto_aggregated"` — `conversationDigest` или `feedbackText` или `debugExtraction`.
- Поведение: загрузка активного натала и предыдущей калибровки; промпт `calibration_extraction` из БД; `generateGeminiJson` → `averageCalibration(natal, extraction, source)` → `buildStatesMap`, `buildLexicon`; деактивация старой строки `user_calibrations`, вставка новой; инвалидация `user_daily_forecasts` с локальной «сегодняшней» даты пользователя; включение Ultra-режима в `user_settings.preferences` на `3` дня (`ultraModeUntil`, `ultraModeSource: "calibration"`, ссылки на версию калибровки).
- Ответ: `{ calibration, ultraMode, debug? }` (`debug` только вне production).

### HTTP: `POST /api/calibration/transcribe`

- JWT обязателен; тело как у Groq Whisper (`TranscribeAudioBody`); реализация: `transcribeGroqAudio`. Сохраняется для паритета и альтернативных клиентов; текущий экран калибровки в приложении его **не** вызывает.

### Edge: `supabase/functions/auto-calibrate`

- `Deno.serve`: требуется `assertCronSecret` (cron/секрет), не пользовательский JWT.
- Выборка до `BATCH_SIZE` (`50`) активных `user_calibrations` с `last_calibration_date` не новее `MIN_DAYS_BETWEEN_CALIBRATIONS` (`7`) дней.
- Для каждой записи: пропуск если недавняя калибровка, уже есть «живой» `autoCalibrationProposal`, недавний reject (`isRejectedRecently`), мало сообщений пользователя (`MIN_USER_MESSAGES` = `5`), или дайджест Gemini не показал достаточно изменений (`significantChanges < 3` или `confidence < 0.45`).
- При успехе: запись предложения в `user_settings.preferences.autoCalibrationProposal` (`status: "pending"`, `expiresAt` через `PROPOSAL_TTL_DAYS` = `14`) и лог `user_event_log` `calibration_suggested`.

### Типы и константы домена (`_legacy_web/app/api/_utils/calibration.ts`)

- `CalibrationSource`, `AVERAGING_WEIGHTS` (`initial`/`manual_resync`: `0.6`/`0.4` натал/предложение; `auto_aggregated`: `0.5`/`0.5`).
- `averageCalibration`, `buildStatesMap`, `buildLexicon`, типы `CalibrationExtraction`, `StatesMap`, `UserLexicon`, `CalibrationRow` и др. — используются маршрутом `extract` и отражают контракт строки БД.

### Вспомогательные даты

- `todayLocalDate(timezone, at?)`, `getUserTimezone(db, userId)` в `forecast-cache-date.ts` — календарная дата пользователя для среза кэша прогнозов (используются также другими API; здесь — часть сценария extract).

## 3. Внутренняя архитектура

- **Экран** управляет только UX-потоком записи и вызывает транскрипцию + `extractCalibration`; бизнес-логики усреднения на клиенте нет.
- **`extract/route.ts`** оркестрирует загрузку контекста, вызов LLM, постобработку через `_utils/calibration`, запись в Supabase и побочные эффекты (кэш прогнозов, Ultra).
- **`_utils/calibration.ts`** — чистые преобразования: взвешенное усреднение S/H, сборка семантической карты из baseline (`_legacy_web/data/chakra_states_baseline.json`) и извлечения, слияние лексикона с предыдущей версией.
- **`auto-calibrate/index.ts`** читает диалоги после `last_calibration_date`, строит компактный DTO (`_shared/dto.ts`), опционально зовёт Gemini для дайджеста, принимает решение о предложении и пишет только в `user_settings` / лог.
- **`proposal.ts`** инкапсулирует TTL предложения, fallback если нет `expiresAt`, и cooldown после отказа.

## 4. Конфигурация и параметры

- Промпт и параметры генерации: строка `calibration_extraction` в таблице промптов (модель/temperature/max tokens через `getActivePrompt` / `getModelByHint`).
- Baseline состояний: JSON `chakra_states_baseline.json` в `_legacy_web/data/` (импорт в `extract`).
- Переменные Edge: `GEMINI_API_KEY`, cron secret (через `_shared/supabase.ts` / `assertCronSecret`), tier env для `resolveGeminiModelIdFromTierEnv("premium")`.
- Константы экрана: `MIN_VOICE_MS`, `LOW_TRANSCRIPTION_CONFIDENCE`; режим аудио iOS через `Audio.setAudioModeAsync`.
- `debugExtraction` на сервере только вне `production` для детерминированных прогонов без Gemini.

## 5. Известные ограничения

- Транскрипция на устройстве идёт через **communicator v2**, хотя существует зеркальный `calibration/transcribe` — два entry point к одному типу Whisper-вызова; документация и старые ТЗ могут ссылаться только на путь калибровки.
- Автокалибровка **не** создаёт финальную калибровку сама: только предложение в preferences; применение остаётся продуктовым сценарием (вне этого файла).
- Инвалидация прогноза привязана к локальной дате пользователя (`users.tz`); при некорректном tz срез кэша может сдвигаться.
- При ошибке парсинга JSON от Gemini extract подставляет «пустое» извлечение с нулевыми дельтами и fallback reasoning, вместо жёсткого 500 (см. `GeminiJsonParseError`).
