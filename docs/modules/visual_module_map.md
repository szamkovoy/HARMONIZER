# VISUAL_MODULE_MAP

Рабочая шпаргалка по визуальным веткам HARMONIZER. Нужна как быстрый reference-файл, чтобы:

- помнить, какие визуальные модули уже существуют;
- быстро возвращаться к их структуре;
- корректно ставить задачи по нужной ветке;
- не путать основной runtime, лаборатории и сохраненные эксперименты.

## 1. Общая структура

Все три визуальные линии живут внутри одного большого модуля:

- корневой модуль: `modules/mandala/`

Внутри него сейчас важно различать два слоя:

- `ui/` — основной runtime и sandbox-ветка;
- `experiments/` — изолированные исследовательские ветки, которые не должны ломать основной runtime.

Из-за этого в приложении на телефоне видны три разные визуальные линии, хотя технически они принадлежат одному visual ecosystem.

## 2. Три основные ветки

### 2.1. Bindu Algorithm

Это наиболее завершенная и приоритетная ветка.

Как называется в коде:

- route: `app/bindu-succession-lab.tsx`
- screen: `modules/mandala/experiments/BinduSuccessionLabScreen.tsx`
- canvas: `modules/mandala/experiments/BinduSuccessionLabCanvas.tsx`
- docs: `docs/modules/bindu_succession_lab.md`

Как называется в приложении:

- `Bindu Succession Lab`

Что это по сути:

- отдельная R&D-лаборатория;
- логика построена вокруг `bindu -> succession`;
- новая мандала рождается из центра и вытесняет предыдущую наружу;
- геометрия считается на CPU, а shader заполняет уже готовые оболочки орнаментом;
- сейчас именно эта ветка является главным кандидатом на дальнейшую интеграцию с другими частями приложения.

Что уже закреплено в этой ветке:

- рабочая `bindu/succession` геометрия;
- рабочий fade внешних колец;
- cloud под мандалой;
- режим `showMandala`;
- chakra color presets;
- редактор цветов с `swatches + hex`;
- live preview;
- локальное сохранение preset override на устройстве;
- независимое вращение колец.

Практическое правило:

- если в задаче говорится `Bindu`, `Bindu algorithm`, `Bindu Lab`, `мандала через bindu/succession`, то смотреть в `BinduSuccessionLabScreen` и `BinduSuccessionLabCanvas`.

### 2.2. Symbol Stream

Это сохраненная удачная ветка, которая родилась по пути и была оставлена как отдельный образ.

Как называется в коде:

- route: `app/sacred-symbol-stream.tsx`
- screen: `modules/mandala/experiments/SacredSymbolStreamScreen.tsx`
- canvas: `modules/mandala/experiments/BinduSuccessionFlowCanvas.tsx`

Как называется в приложении:

- в карточке/списке: `Symbol Stream`
- в header экрана: `Sacred Symbol Stream`

Что это по сути:

- preserved variant;
- высокоскоростной поток сакральных символов;
- отдельная экспериментальная линия внутри `experiments/`;
- родственная Bindu-ветке, но не равная текущему `Bindu Succession Lab`.

Что управляется на экране:

- плотность;
- пауза/продолжение;
- `Новая линия`;
- `Следующая мандала`.

Практическое правило:

- если в задаче говорится `Symbol Stream` или `Sacred Symbol Stream`, то смотреть в `SacredSymbolStreamScreen` и `BinduSuccessionFlowCanvas`.

### 2.3. Mandala Sandbox / Lotus Bloom

Это не одна отдельная картинка, а основная debug/dev-площадка большого visual runtime.

Как называется в коде:

- route: `app/mandala-sandbox.tsx`
- screen: `modules/mandala/ui/MandalaSandboxScreen.tsx`

Связанные документы:

- `modules/mandala/readme.md`
- `docs/modules/mandala.md`
- `docs/modules/lotus_bloom_evolution_strategy.md`
- `docs/modules/lotus_bloom_evolving_requirements.md`
- `docs/modules/meditation_session_dramaturgy.md`

Как называется в приложении:

- `Mandala Sandbox`

Что это по сути:

- основной sandbox большого visual engine;
- центральная debug/dev-площадка по линии `Lotus Bloom`;
- место для настройки keyframe/state/runtime-логики;
- внутри этой ветки заморожено несколько интересных визуальных направлений, к которым можно вернуться позже.

Практическое правило:

- если в задаче говорится `Mandala Sandbox`, `Lotus Bloom`, `основной visual runtime`, то смотреть прежде всего в `MandalaSandboxScreen` и основной runtime `modules/mandala/ui/` + `modules/mandala/core/`.

## 3. Как они соотносятся

Это не три независимых проекта, а три линии внутри одного visual ecosystem:

- `Mandala Sandbox` — основной runtime и главная debug/dev-площадка;
- `Bindu Algorithm` — отдельная лаборатория для новой grammar видеомедитации;
- `Symbol Stream` — сохраненный отдельный эксперимент;
- все три линии принадлежат `modules/mandala`.

Если очень коротко:

- `Sandbox` = основной engine;
- `Bindu` = отдельная лаборатория;
- `Symbol Stream` = сохраненный эксперимент.

## 4. Как формулировать задачи

Если речь про Bindu:

- `работаем в Bindu algorithm`
- `открой Bindu Lab`
- `измени succession-геометрию`
- `поправь cloud в Bindu`
- `поменяй color preset flow в Bindu`

Если речь про Symbol Stream:

- `работаем в Symbol Stream`
- `поправь preserved variant`
- `измени поток символов в Sacred Symbol Stream`
- `проверь BinduSuccessionFlowCanvas`

Если речь про Sandbox / Lotus Bloom:

- `работаем в Mandala Sandbox`
- `возвращаемся к Lotus Bloom`
- `проверь основной visual runtime`
- `поправь sandbox keyframe logic`
- `настрой evolution grammar Lotus Bloom`

## 5. Текущие согласованные параметры колец для Bindu Algorithm

Ниже художественный reference для текущей Bindu-линии. Это важно держать как опорную таблицу, даже если часть значений в конкретный момент может жить не в кодовых default'ах, а в локально сохраненных editor override.

### 5.1. Цвета

- `bindu` -> `Eye Seeds` -> кружки золотой -> `#FAC757`
- `ring1` -> `Lotus Petals Belt` -> розово-малиновый -> `#FF668F`
- `ring2` -> сетка -> светло-циановый -> `#66E6FF`
- `ring3` -> члены -> фиолетовый -> `#A87AFF`
- `ring4` -> кривая линия -> мятно-зеленый -> `#70FFAD`
- `ring5` -> `Rosette Window Chain` -> кружки с палочками янтарно-оранжевый -> `#FFA852`
- `ring6` -> `Scallop Lace` -> холодный голубой -> `#57C2FF`

### 5.2. Вращение

Значения указаны в `rpm`. Отрицательное значение означает вращение против часовой стрелки.

- `bindu = -0.3`
- `ring1 = 0.3`
- `ring2 = 0`
- `ring3 = 0.2`
- `ring4 = 0.1`
- `ring5 = -0.2`
- `ring6 = 0`

### 5.3. Ширины

- `bindu = 9%`
- `ring1 = 18%`
- `ring2 = 12%`
- `ring3 = 20%`
- `ring4 = 6%`
- `ring5 = 17%`
- `ring6 = 24%`

## 6. Короткий словарь для будущих задач

Когда в разговоре используется:

- `Bindu` — это `BinduSuccessionLabScreen` / `BinduSuccessionLabCanvas`
- `Symbol Stream` — это `SacredSymbolStreamScreen` / `BinduSuccessionFlowCanvas`
- `Lotus Bloom` или `Mandala Sandbox` — это `MandalaSandboxScreen` и основной runtime `mandala`

## 7. Короткий вывод по приоритетам

На текущем этапе:

- `Bindu Algorithm` — самый готовый кандидат для дальнейшей интеграции;
- `Symbol Stream` — художественно ценная сохраненная ветка;
- `Mandala Sandbox` — важный архив и рабочая площадка основного visual engine, особенно по линии `Lotus Bloom`.
