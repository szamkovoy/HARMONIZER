# BINDU_SUCCESSION_VISUAL_SPEC_V2

Конкретное ТЗ для следующей фазы `Bindu Succession Lab`: не чинить больше базовую CPU-геометрию, а построить выразительный визуальный язык для трансовой медитации на мобильном телефоне.

## Цель

Собрать не просто набор паттернов на кольцах, а устойчивую визуальную систему, которая:

- удерживает внимание 3-30 минут;
- не скатывается в скучную повторяемость;
- не превращается в визуальный шум;
- поддерживает переход от более ясного состояния к более погруженному;
- остается реализуемой в `React Native + Skia` на телефоне.

## Что считаем базой

Уже найденная основа:

- CPU-driven `shell stack` остается источником истины;
- оболочки продолжают непрерывно рождаться из центра и уходить наружу;
- shader используется как содержимое кольца, а не как источник геометрии;
- границы между кольцами уже существуют и должны стать художественным материалом, а не только технической разметкой.

## Главный художественный принцип

Финальная картинка не должна быть “все мотивы сразу”.  
Финальная картинка должна быть устроена как **живая сакральная диафрагма**, где:

- центр магнитный и спокойный;
- средние кольца наиболее богаты деталями;
- внешние кольца более редкие, просторные и атмосферные;
- часть слоев статична;
- часть медленно вращается;
- часть реагирует на дыхание и пульс светом.

## Технический принцип

Основной путь: **procedural / semi-procedural belts**, а не PNG-ленты как фундамент.

Почему:

- procedural-слои легче синхронизировать с дыханием и пульсом;
- их легче деформировать без артефактов;
- они лучше живут внутри `annulus clip`;
- они выглядят менее “наклеенными”.

PNG-ассеты допустимы позже только как редкие спец-слои или текстурные оверлеи, но не как основной механизм всех поясов.

## Роли колец

Каждый `shell` получает не “случайный мотив”, а `role`.

Базовые роли:

1. `BoundaryRole`
2. `CoreRole`
3. `PetalBeltRole`
4. `GeometryBeltRole`
5. `OrnamentalBeltRole`
6. `AuraBeltRole`

Рекомендованное распределение по shell stack:

- самый внутренний диск: `CoreRole`
- ближайший annulus: `PetalBeltRole`
- следующий: `GeometryBeltRole`
- следующий: `OrnamentalBeltRole`
- следующий: `PetalBeltRole` или `GeometryBeltRole`
- внешний: `AuraBeltRole`

Не все роли обязаны присутствовать одновременно.  
В конкретной сцене должно быть:

- 1 доминирующая роль;
- 1 поддерживающая роль;
- 1 редкий accent.

## BoundaryRole

### Назначение

Сделать границы между кольцами живыми, мягкими и “ручными”, но не волнистыми и не неряшливыми.

### Вариант A: Soft Ink Boundary

Что видит пользователь:

- тонкая линия;
- немного неидеальная;
- чуть меняющая толщину;
- как будто прорисована рукой тушью.

Технически:

- shared boundary path на CPU или в shader через `boundarySeed`;
- радиальная девиация очень малая: `0.2% - 0.6%` от радиуса;
- line width modulation: `6% - 14%`;
- никаких высокочастотных шумов;
- 2-3 синус-компоненты низкой частоты достаточно.

Формула:

- `r(theta) = baseR * (1 + a1*sin(k1*theta+p1) + a2*sin(k2*theta+p2))`
- `k1,k2`: `3..7`
- `a1,a2`: `0.002..0.006`

### Вариант B: Twin Boundary

Что видит пользователь:

- не одна жесткая линия, а две очень близкие полупрозрачные линии;
- возникает ощущение тонкой ручной каемки.

Технически:

- строить один boundary path;
- поверх него рисовать второй path с небольшим radial offset;
- второй path слабее по opacity и тоньше.

### Вариант C: Dry Brush Boundary

Что видит пользователь:

- линия местами чуть тоньше, местами чуть насыщеннее;
- будто край слегка сухой кистью.

Технически:

- не деформировать форму сильнее;
- модулировать только opacity и width по углу;
- использовать один и тот же seed для shared boundary у соседних shells.

### Ограничения

- нельзя делать boundary независимой для двух соседних shells;
- одна общая граница должна вычисляться один раз и использоваться обоими слоями;
- граница не должна превращаться в синусоиду или лепесток сама по себе.

## CoreRole

### Назначение

Центр должен быть магнитным, спокойным и достаточно простым, чтобы не создавать тревогу.

### Вариант A: Quiet Bindu

- темный центр;
- одна или две тонкие каемки;
- очень слабый внутренний glow;
- никаких сложных узоров в самом ядре.

### Вариант B: Seed Rosette

- маленькая 8-12-лучевая розетка;
- низкий контраст;
- очень тонкая штриховка;
- без перегруза деталями.

### Вариант C: Lotus Seed

- маленький лотосный венец в центре;
- один внутренний лепестковый пояс;
- очень спокойная анимация.

### Рекомендация

Начинать с `Quiet Bindu`, потом пробовать `Seed Rosette`.

## PetalBeltRole

### Назначение

Это главный источник органической, сакральной и эмоционально теплой формы.

### Вариант A: Lotus Crown

Что рисуем:

- крупные острые лепестки наружу;
- второй внутренний контур лепестка;
- очень легкая заливка между контуром и внутренней жилкой.

Технически:

- `12-24` лепестков;
- outer tip pointed, not rounded;
- форма лепестка строится не как простая синусоида, а как комбинация:
  - базовый petal envelope;
  - заостренный tip taper;
  - inner spine line;
- ширина лепестка чуть варьируется от лепестка к лепестку;
- deviation у соседних лепестков не более `5% - 8%`.

Prompt:

`Implement a petal belt inside one annulus shell as a lotus crown with 12-24 pointed petals, dual contour lines, a thin inner spine per petal, and tiny per-petal width variation. Avoid sinusoidal wobble. The result should feel like hand-drawn mandala petals, not a waveform.`

### Вариант B: Double Petal Rosette

Что рисуем:

- внешний ряд длинных лепестков;
- внутренний ряд коротких лепестков;
- между ними тонкий разделяющий пояс.

Технически:

- outer row: `10-18` лепестков;
- inner row: тот же count или `x2`;
- rows slightly offset by angle;
- одна row доминирует, вторая только поддерживает.

Prompt:

`Implement a double petal belt with one dominant outer petal row and one smaller inner row, angle-offset from each other. Keep the second row lighter and thinner so the belt remains readable and not overloaded.`

### Вариант C: Scalloped Lotus Arc

Что рисуем:

- не полные лепестки, а мягкие scalloped арки;
- как венец из дуг с острыми намеками на лепесток.

Технически:

- подходит для более внешних колец;
- меньше detail density;
- хорошо сочетается с bead accents.

Prompt:

`Implement a scalloped lotus belt using repeated arched segments with subtle pointed tips, less dense than full petals. It should read as a lotus-derived crown, not as mechanical circles.`

## GeometryBeltRole

### Назначение

Давать уму структуру, загадку и ясную сакральную логику.

### Вариант A: Flower Mesh Lite

Что рисуем:

- упрощенную interlocking-circle geometry;
- без перегруза полным flower-of-life;
- только читабельные пересечения внутри annulus.

Технически:

- использовать 1-2 радиуса дуг;
- не более `6-12` узлов по окружности;
- линии тонкие, без сильной заливки.

Prompt:

`Implement a light sacred-geometry belt based on interlocking circular arcs, clipped to the annulus. Keep it sparse and readable, closer to a flower-of-life fragment than to a full dense grid.`

### Вариант B: Yantra Lattice Ring

Что рисуем:

- треугольные и ромбические связи;
- ощущение янтры, но только в поясе;
- диагональные пересечения, вписанные в кольцо.

Технически:

- angle snapping;
- triangle / diamond segments;
- тонкий контур, почти без fill.

Prompt:

`Implement a yantra-inspired lattice belt using triangles and diamonds arranged around the annulus. The belt should feel ceremonial and precise, but not heavy or too dense.`

### Вариант C: Radial Gate Geometry

Что рисуем:

- повторяющиеся “ворота” или проемы;
- радиальные стойки и поперечные связи;
- архитектурное, храмовое ощущение.

Технически:

- лучше для средних или внешних колец;
- count `8-20`;
- alternating thickness allowed.

Prompt:

`Implement a radial gate belt with repeated arch-gate modules around the annulus: radial bars, top bridges, and sparse inner connectors. It should feel architectural rather than floral.`

## OrnamentalBeltRole

### Назначение

Добавить ощущение ручной богатой графики, филлигранности и загадки.

### Вариант A: Bead Chain

Что рисуем:

- цепочка бусин;
- бусины разного размера в небольшом диапазоне;
- между ними тонкие связующие дуги.

Технически:

- count `16-40`;
- variation размера бусин `8% - 15%`;
- можно запускать pulse highlight по бусинам.

Prompt:

`Implement an ornamental bead-chain belt with 16-40 beads, subtle bead size variation, and thin linking arcs. Keep it elegant and ritual-like, not decorative overload.`

### Вариант B: Filigree Branches

Что рисуем:

- тонкие веточки;
- небольшие завитки;
- симметричная, но живая каллиграфия.

Технически:

- не использовать высокую плотность;
- 1 основной ствол + 1-2 secondary curls;
- хорошо работает в узком annulus.

Prompt:

`Implement a filigree branch belt with a primary curling stroke and 1-2 secondary decorative curls per sector. Keep the result airy, hand-drawn, and not too dense.`

### Вариант C: Calligraphic Arcs

Что рисуем:

- ритмические дуги;
- тонкие “чернильные” изгибы;
- возможно, с каплевидными окончаниями.

Технически:

- можно строить как repeating arc modules;
- varying stroke pressure by angle;
- без буквенных или этнически конкретных знаков на этой стадии.

Prompt:

`Implement a calligraphic ornamental belt made of repeating ink-like arcs with slight pressure variation and teardrop endings. It should feel ceremonial and flowing, not like text.`

## AuraBeltRole

### Назначение

Создавать атмосферу, дыхание, дальний план и трансовую глубину.

### Вариант A: Breathing Mist Band

Что рисуем:

- почти без линий;
- мягкий туманный пояс;
- глубина за счет полупрозрачных слоев.

Технически:

- low-frequency radial glow;
- opacity breathing;
- detail density минимальная.

Prompt:

`Implement an aura belt as a soft breathing mist band with almost no hard lines. Use layered glow and gentle opacity gradients so the annulus feels spacious and atmospheric.`

### Вариант B: Traveling Ripples

Что рисуем:

- очень мягкие ripple-волны;
- будто по кольцу проходят слабые колебания;
- не как синусоидальный график, а как световые пояса.

Технически:

- travelling phase;
- слабая амплитуда;
- лучше для внешних колец.

Prompt:

`Implement an aura belt with slow traveling ripples that move around the annulus as soft luminous waves. Avoid sharp waveform aesthetics; the effect should feel hypnotic and spacious.`

### Вариант C: Star Dust Halo

Что рисуем:

- редкие точки, пыль, микроузлы;
- слабое мерцание;
- halo around the belt.

Технически:

- sparse particles;
- very low brightness;
- no arcade glitter.

Prompt:

`Implement an aura halo with sparse star-dust particles and very soft flicker, clipped to the annulus. Keep it meditative and deep, avoiding glitter or sparkly noise.`

## Правило “ручной живости”

Все роли должны чувствоваться чуть-чуть живыми, но не кривыми.

### Что добавляем

- очень малая радиальная неровность;
- микровариацию толщины линии;
- небольшую неидеальность повторяющихся модулей;
- разные seed-характеры для разных shells.

### Что не добавляем

- сильную волнистость;
- high-frequency noise;
- случайные дерганые артефакты;
- независимую кривизну у shared boundaries.

### Спецификация

Для `boundary`:

- radial deviation: `0.2% - 0.6%`;
- width modulation: `6% - 14%`;
- low frequency only.

Для `ornament`:

- module size variation: `4% - 10%`;
- angle variation: `1° - 4°`;
- line pressure variation: `8% - 18%`.

Для `petal tips`:

- tip length variation: `5% - 10%`;
- no random jitter per frame;
- only seed-locked variation.

## Что делать с дыханием и пульсом

Пока не внедрять глубоко в форму, но сразу заложить как контракт.

### Breath hook

Разрешенные влияния:

- скорость outward growth: `+/- 6% - 12%`;
- glow intensity: `+/- 8% - 18%`;
- мягкое раскрытие пояса: `+/- 2% - 5%`;
- общая прозрачность aura belts.

Не разрешено:

- менять topology мотива;
- пересобирать count лепестков;
- ломать shell continuity.

### Pulse hook

Разрешенные влияния:

- traveling highlight по bead-chain;
- краткий акцент на selected arcs;
- световой пробег по geometry lattice;
- короткое усиление одного ornamental stroke.

Параметры:

- duration одного импульса: `120ms - 180ms`;
- amplitude небольшая;
- одновременно активны не более `1-3` акцентных дорожек.

### Brain-state hook

Позже можно вводить profile-driven visual states:

- `Beta`: яснее геометрия, больше контраста, меньше ауры;
- `Alpha`: баланс лепестков и геометрии;
- `Theta`: больше aura и filigree, меньше жесткой структуры;
- `Delta`: крупные мягкие пояса, минимум detail density, почти без активных акцентов.

## Что делать первым

Самый быстрый и эффективный порядок такой:

1. Довести `BoundaryRole`.
2. Сделать один `PetalBeltRole` в одном тестовом кольце.
3. Выбрать лучший лепестковый вариант.
4. Сделать один `GeometryBeltRole` в одном тестовом кольце.
5. Сделать один `OrnamentalBeltRole`.
6. Сделать один `AuraBeltRole`.
7. Только потом собирать их в общую драматургию.

## Почему начинать с boundary

Потому что это:

- самый быстрый видимый выигрыш;
- влияет на всю мандалу сразу;
- задает “ручной” характер еще до сложных узоров;
- не требует тяжелой перестройки shader grammar.

## Минимальный production-пакет

Если нужно быстро получить сильный визуальный результат, первый production-набор такой:

- `BoundaryRole`: Soft Ink Boundary
- `CoreRole`: Quiet Bindu
- `PetalBeltRole`: Lotus Crown
- `GeometryBeltRole`: Flower Mesh Lite
- `OrnamentalBeltRole`: Bead Chain
- `AuraBeltRole`: Breathing Mist Band

Это даст:

- читаемую и красивую иерархию;
- меньше шума;
- сильную базу для дальнейшей биометрической синхронизации.

## Конкретное ТЗ на ближайший шаг

### Шаг 1

Сделать `BoundaryRole / Soft Ink Boundary`.

Задача:

- shared boundary becomes slightly hand-drawn;
- inner and outer shell edges remain perfectly shared between adjacent shells;
- thickness stops being mechanically uniform;
- no visible wave effect.

### Шаг 2

На одном выбранном annulus реализовать `PetalBeltRole / Lotus Crown`.

Задача:

- не показывать сразу все мотивы;
- не смешивать petal belt с geometry belt;
- получить одно по-настоящему красивое кольцо.

### Шаг 3

На другом annulus реализовать `GeometryBeltRole / Flower Mesh Lite`.

### Шаг 4

Сравнить:

- что сильнее удерживает внимание;
- что выглядит более сакрально;
- что менее шумно на телефоне.

## Запреты

На текущем этапе не делать:

- все мотивы сразу как финальный режим;
- тяжелые PNG-обертывания всех поясов;
- сильную психоделическую дерготню;
- высокочастотные деформации линий;
- рандомный motion на каждом кольце одновременно.

## Вывод

Следующий этап разработки должен быть не “добавить больше паттернов”, а:

- ввести роли колец;
- сделать одну красивую систему границ;
- собрать по одному сильному представителю для каждого типа пояса;
- потом уже подключать цвет, вращение, пульс и дыхание.
