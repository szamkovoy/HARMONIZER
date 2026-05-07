---
id: 02_modules/communicator/history
title: Communicator History
version: 1.1
updated: 2026-05-07
depends_on: [01_foundation/architecture, 02_modules/assistant/spec]
code_refs: [modules/communicator/ui/Communicator.tsx, services/communicator-client.ts]
---

## Decision Log

- **Не датировано (источник до RN):** Ранний текст «Коммуникатор» описывал стек Next.js, Tailwind и стриминг через клиентский Gemini SDK с разбором `[T]…[/T]` в ответе. Фактическая реализация — **React Native (Expo)**, стриминг ответа ассистента через **SSE с Vercel API**, транскрипция голоса через **`/api/communicator/v2/transcribe`**, а не через прямой SDK в UI. Канон зафиксирован в коде; исходный текст перенесён в `docs/05_archive/migrated/communicator/Коммуникатор.txt`.

- **2026-05:** Условный выбор базового URL диалога в **`sendDialogMessage`**: при наличии `scenario_id` используется `/api/ai/dialog`, иначе `/api/communicator/v2/dialog`. Текущий экран **`Communicator`** на главной не передаёт `scenarioId` в поток — домашний сценарий опирается на v2 URL. Объединение путей на клиенте остаётся предметом раздела `assistant` в open questions.

- **2026-05:** Экран **`app/calibration.tsx`** специально не встроен в **`Communicator`**: переиспользуются только клиентские вызовы транскрибации и извлечения калибровки, чтобы не смешивать UX «уточнения фундамента» с диалогом дня.

- **2026-05:** Очередь **`pending-greeting`** задумана для сценария «обсудить результаты практики» после дыхания (`enqueueCommunicatorGreeting` из **`CoherenceBreathScreen`**). Факт подключения **`consumeCommunicatorGreeting`** к монтированию **`Communicator`** на главном экране в кодовой базе не найден — см. рабочие вопросы.

- **Не датировано:** Исторические разделы про SSE и фронтенд в **`docs/05_archive/migrated/assistant/MODULE_4_AIAssistant_TZ.md`** и бриф по карточке практики **`docs/05_archive/migrated/practices/assistant_practice_recommendation_brief.md`** использовались как контекст; актуальное поведение клиента зафиксировано в `spec.md` по текущему коду.
