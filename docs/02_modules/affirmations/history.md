---
id: 02_modules/affirmations/history
title: Affirmations History
version: 1.0
updated: 2026-08-14
depends_on: [02_modules/affirmations/spec]
code_refs: []
---

## Decision Log

- **2026-08-14 (QA polish):** Виджет без disabled-flash; mic arming + anti-double-start; scroll-to-top после generate/refine; manage day lineHeight; breath panel `2×` safe-area; finale voice на ~1 цикл раньше (окно 4.2, cap 3).

- **2026-08-14 (UX + mic fix):** Виджет только на группе «Дыхание»; close на create/manage; MicRecordButton вместо «Записать»; `startWhisperRecording` (как Communicator) — фикс ошибки сразу после grant микрофона.

- **2026-08-14 (wire + soft book turn):** Подключены виджет на Практиках, overlay в Coherence (wait audio → results + day bump), Stack routes; миграция `user_affirmations` на prod; docs triad. Книга: мягкий slide/fade при листании paginated (не 3D curl).

- **2026-08-14 (foundation):** Additive table + Storage, API generate/CRUD/upload/practice-complete, client wizard/manage/overlay, FeatureKey master + soft gate, i18n ×8. Next.js: serializers вне `route.ts` (`affirmationShared.ts`); generate imports `../prompts`.
