---
id: 02_modules/bindu/evolution_lab
title: Bindu Evolution Lab
version: 1.1
updated: 2026-05-06
depends_on: [01_foundation/architecture, 02_modules/practices/spec, 02_modules/audio/spec, 02_modules/biofeedback/spec]
code_refs: [modules/mandala/ui/MandalaCanvas.tsx, modules/mandala/ui/evolution-registry.ts, modules/mandala/experiments/BinduSuccessionLabCanvas.tsx, modules/breath/ui/BreathBinduMandala.tsx, app/mandala-sandbox.tsx, app/bindu-succession-lab.tsx, app/sacred-symbol-stream.tsx]
---

## 1. Runtime experiments (Bindu succession)

Изолированная ветка для видеомедитативного пайплайна **без изменения** публичного контракта основного `MandalaCanvas`.

**Точки входа**

- Route: `app/bindu-succession-lab.tsx` → `BinduSuccessionLabScreen` (`modules/mandala/experiments/BinduSuccessionLabScreen.tsx`).
- Canvas: `BinduSuccessionLabCanvas.tsx` — разделение **CPU geometry → shell stack → shader content**; шейдер заполняет орнамент внутри уже вычисленных оболочек, а не строит радиальную трубу целиком.

**Идея succession**

- Новая мандала **рождается в bindu** и вытесняет предыдущую к краю экрана; удержание внимания за счёт смены цельных архетипов, а не только микроморфинга одного лепестка.
- Режим **`showMandala`** на экране лаборатории позволяет смотреть облако отдельно от мандалы.
- Цвета: typed пресеты `binduSuccessionVisualPresets.ts` (слоты `cloud`, `ringImageColor.bindu`, `ring1`…`ring6`), редактор swatch/hex, локальный override в JSON на устройстве.

**Архитектура tube / CPU**

- Источник истины для геометрии — CPU-owned **shell stack**; у shell lifecycle (`embryoDisk` → `annulus` → выход за лимит).
- Полезно различать два такта: **geometry clock** (радиальный рост, границы) и **genome clock** (какие геномы в стеке слоёв), без взаимного толкания.
- Параметры вращения (обороты в стиле rpm для колец) и ширины колец зафиксированы в продуктовых заметках; см. также архив `Бинду.txt` в `docs/05_archive/migrated/bindu/`.

**Связь с практикой**

- Тот же canvas использует **`BreathBinduMandala`** в когерентном дыхании; лаборатория — место настройки визуала, практика — стабильный потребитель.

Полный исходный текст лабораторного readme перенесён в архив: `docs/05_archive/migrated/bindu/bindu_succession_lab.md`.

## 2. Visual spec (наследие v2)

Цели художественной линии (из архивного ТЗ v2): удержание 3–30 минут без шума и монотонности; «сакральная диафрагма» (спокойный центр, богатые средние кольца, редкие внешние пояса); процедурные / semi-procedural belts вместо PNG-лент как основы; роли поясов (`Boundary`, `Core`, `PetalBelt`, и т.д.) как язык дизайна.

**Статус относительно кода:** документ задавал направление; реализация проверяется по `BinduSuccessionLabCanvas.tsx` и связанным шейдерам. Полный текст: `docs/05_archive/migrated/bindu/bindu_succession_visual_spec_v2.md`.

## 3. Другие ветки (кратко)

- **`Sacred Symbol Stream`**: `app/sacred-symbol-stream.tsx`, `BinduSuccessionFlowCanvas` — отдельный сохранённый flow; общий паттерн синхронизации с аудио как у lab canvas.
- **Песочница Lotus / `MandalaCanvas`**: `app/mandala-sandbox.tsx` — отладка рецепта `lotusBloom` и полного контракта keyframe; не смешивается с кодом succession-lab.

Карта всех визуальных веток до миграции: `docs/05_archive/migrated/bindu/visual_module_map.md`.
