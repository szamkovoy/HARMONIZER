---
id: 02_modules/bindu/history
title: Bindu History
version: 1.1
updated: 2026-05-06
depends_on: [01_foundation/architecture, 02_modules/practices/spec, 02_modules/audio/spec, 02_modules/biofeedback/spec]
code_refs: [modules/mandala/ui/MandalaCanvas.tsx, modules/mandala/ui/evolution-registry.ts, modules/mandala/experiments/BinduSuccessionLabCanvas.tsx, modules/breath/ui/BreathBinduMandala.tsx, app/mandala-sandbox.tsx, app/bindu-succession-lab.tsx, app/sacred-symbol-stream.tsx]
---

## Decision Log

- **2026-05:** Зафиксирована двухконтурная визуальная архитектура в коде: основной Skia-рантайм `MandalaCanvas` (сценарий + `BioSignalFrame`) и изолированная линия **Bindu succession** (`BinduSuccessionLabCanvas` / lab screen). Исторический документ лаборатории явно требовал не менять контракт основного MANDALA при экспериментах — в репозитории это соблюдено отдельными файлами и маршрутами.

- **2026-05:** Канон по аудио отходит от старого ТЗ генератора видео-медитаций: в `docs/05_archive/migrated/bindu/meditation_video_generator_spec.md` первая фаза описывает `MandalaAudioEngine` как будущий контракт, тогда как в коде уже существует отдельный модуль `modules/mandala-sound` с `expo-av` и своим жизненным циклом; связка с визуалом идёт через `MandalaAudioContract` / `buildAudioContract` и `MandalaSoundVisualSync`, а не через описанный в старом документе единый черновик движка.

- **2026-05:** Документировано расхождение карты зависимостей с прямыми импортами: пакет `modules/mandala` не импортирует `modules/biofeedback`, но **`MandalaBioFrameAdapter`** в биофидбеке импортирует **`BioSignalFrame`** из мандалы; живая связь дыхательного UI с пульсом в текущем коде идёт через **`MandalaSoundProvider`** и `externalSync`, а не через прямую подписку канваса на шину в `BreathBinduMandala`.

- **2026-05:** Песочница `MandalaSandboxScreen` подает в `MandalaCanvas` **офлайн-константу** `BioSignalFrame` с комментарием про временное отключение био-влияния при полировке lotus — это расходится с нарративом старого ТЗ о постоянном `BioSim`/микшере как обязательном источнике для debug, но соответствует актуальному коду.

- **2026-05:** Визуальная спецификация v2 (архив) задаёт художественные роли колец и belt-систему; реализация в `BinduSuccessionLabCanvas` следует общей идее CPU shell stack + shader ornament, но не обязана построчно совпадать с перечнем ролей из исторического ТЗ — канон за поведением шейдера и геометрии в коде.
