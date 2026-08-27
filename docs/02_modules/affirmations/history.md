---
id: 02_modules/affirmations/history
title: Affirmations History
version: 1.1
updated: 2026-08-24
depends_on: [02_modules/affirmations/spec]
code_refs: []
---

## Decision Log

- **2026-08-24 (breath finale timing fix):** Оверлей аффирмации переписан: (1) голос/панель появляются **ровно с началом выдоха** (убрано упреждение `VOICE_LEAD_MS = 1с` и setTimeout на inhale-onset — теперь срабатываем прямо на exhale-onset); (2) момент финала считается в **выдохах**, а не в циклах планировщика. `CoherenceBreathScreen` передаёт новый проп `msExhaleInterval = cycleMs / exhalesPerCycle` (для nadi-shodhana — `cycleMs/2`, для остальных — `cycleMs`). Финал = ровно 3 последних выдоха: `exhalesRemaining = floor((remaining-1)/exhaleInterval)+1`, аффирмация срабатывает на exhale-onset при `exhalesRemaining <= 3`. Баг: ранее окно `avgCycle * 4.2` было калибровано под 1 выдох/цикл, поэтому для nadi-shodhana (2 выдоха/цикл) финал стартовал в ~2× раньше → после 3 аффирмаций оставалось 4–5 «лишних» дыхательных циклов; для triangle-up оставался 1 лишний цикл. Теперь третья аффирмация приходится на последний выдох, практика заканчивается до следующего вдоха. Pre-warm аудио перенесён на `exhalesRemaining <= 4` (за 1 выдох до финала). `msInhaleToExhale` остался в Props для совместимости, но больше не используется.

- **2026-08-22 (affirmation copy polish):** `step1.instruction` сокращён (без «тройного» повторения / 1–2 мин; «расскажите» + три пункта + «до 3 минут»). Исправлены опечатки RU `афирмац*` → `аффирмац*` в `step3.selectHint`, `step4.editLabel`, `step4.voiceHint`, `manage.noAudio`. Перевод EN+de/fr/it/es/pt/nl через `i18n-sync fill --all` с `AI_MODEL_PREMIUM`.

- **2026-08-22 (create/manage copy + header alignment):** Косметическая правка текстов процесса создания аффирмации во всех 8 локалях (источник — RU, перевод через `i18n-sync fill --all`, модель PREMIUM). `step1.instruction` переписан под санкальпу/йога-нидру + тройное повторение в финальных циклах. `step3.selectHint` расширен пояснением про 1-е/2-е лицо. `step4.editLabel` → «Отредактируйте текст…» (вариант `screenHint` вместо `technicalCaption` — обычный размер шрифта); `step4.voiceTitle` без «(по желанию)»; `step4.voiceHint` переписан. Manage: `noAudio` → мотивация записать голос; новый ключ `affirmation.manage.chartHint` вставлен между `chartTitleWithDay` и графиком. Заголовки обоих экранов (`AffirmationCreateScreen`, `AffirmationManageScreen`) опущены до стандартного уровня: `paddingTop` 8 → 20 (совпадает с `TabScreenLayout` / Practice catalog).

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
