---
id: 02_modules/affirmations/history
title: Affirmations History
version: 1.0
updated: 2026-08-14
depends_on: [02_modules/affirmations/spec]
code_refs: []
---

## Decision Log

- **2026-08-15 (audio warm):** «Прослушать» / breath voice ждали сеть на каждый `createAsync(signedUrl)` + 1 с fade-in → ощущение 3–5 с лага и сдвиг относительно выдоха. Disk-cache + `warmAffirmationPlayback`, fade-in 280 ms; breath больше не unload-ит warm Sound перед каждым cue.

- **2026-08-15 (select hint + phase casing):** Create step3 — подсказка над «Выбрать» (`selectHint`). Manage legend: zone hints в скобках с строчной (RU); остальные локали — по орфографии языка (DE — существительные с заглавной).

- **2026-08-15 (3 min cap UX + STT scale):** Intake/refine уже hard-stop на 3 мин; добавлен countdown последние 20 с под микрофоном, затем auto-stop → Whisper. STT timeout масштабируется по размеру файла (60–120s ×2) — фиксированных 60s мало для полного 3-мин take. 10-минутная запись невозможна по дизайну.

- **2026-08-15 (STT long take):** Intake/refine STT больше не использует 12s communicator timeout (длинная запись → false «Не удалось распознать»); `transcribeAffirmationRecording` 60s ×2. Busy-статус под микрофоном вместо mic-hint; `generating` → «Подготовка аффирмаций…».

- **2026-08-15 (admin prompts):** `affirmation_generate` + `affirmation_refinement` в таблице `prompts` (миграция `20260815150000`); generate читает active через `getActivePrompt` + `{{vars}}`; playground seed из `variables` JSON. Без `{{user_message}}` тест бессмысленен.

- **2026-08-15 (create intro copy):** Обновлён `affirmation.create.step1.instruction` (3 пункта фокуса + лимит 1–2 / max 3 мин) во всех 8 локалях.

- **2026-08-15 (QA polish 2):** Catalog gap −10px; manage mic hint removed; A–D outside chart; one-line phases legend (period at end, same for life-matrix spheres); `warnChange` → «Завершить аффирмацию» ×8; archive in-flight + retry-safe; adaptive edge-trim + 1s fade; finale voice/panel sync via plan `msInhaleToExhale` (not cycle/2). Noise reduction not available via expo-av.

- **2026-08-14 (manage UX + edge trim):** Manage: spinner вместо «Подбираем…»; listen lock; MicRecordButton + «Обновить…»; affirmation card; «Фаза освоения: день…»; график A–D equal bands / past green / future muted; «Закрыть» chip; CTA rename. Voice: metering edge-trim (>1s silence → keep 1s) at playback.

- **2026-08-14 (overlay polish):** Intro hint = finale hint; voice −1s before exhale; panel follows practice dim; 0.5s audio fade on play (manage + breath).

- **2026-08-14 (QA polish):** Виджет без disabled-flash; mic arming + anti-double-start; scroll-to-top после generate/refine; manage day lineHeight; breath panel `2×` safe-area; finale voice на ~1 цикл раньше (окно 4.2, cap 3).

- **2026-08-14 (UX + mic fix):** Виджет только на группе «Дыхание»; close на create/manage; MicRecordButton вместо «Записать»; `startWhisperRecording` (как Communicator) — фикс ошибки сразу после grant микрофона.

- **2026-08-14 (wire + soft book turn):** Подключены виджет на Практиках, overlay в Coherence (wait audio → results + day bump), Stack routes; миграция `user_affirmations` на prod; docs triad. Книга: мягкий slide/fade при листании paginated (не 3D curl).

- **2026-08-14 (foundation):** Additive table + Storage, API generate/CRUD/upload/practice-complete, client wizard/manage/overlay, FeatureKey master + soft gate, i18n ×8. Next.js: serializers вне `route.ts` (`affirmationShared.ts`); generate imports `../prompts`.
