# MODULE 1: ASTRO-CORE — Техническое задание

## Назначение

Модуль рассчитывает натальный профиль пользователя один раз при регистрации (или при изменении данных рождения). Это фундамент всех последующих расчётов — он задаёт силу `S` и гармоничность `H` каждой из 7 планет в карте человека.

Эти параметры **не меняются** в течение жизни пользователя (за исключением калибровки в M3, которая создаёт отдельные `S_calibrated`, `H_calibrated`, не затирая исходные).

## Контракт данных

### Вход

```typescript
interface BirthData {
  date: string;           // ISO date "1980-05-15"
  timeMode: "precise" | "approximate" | "unknown";
  time?: string;          // HH:MM в локальном времени места рождения, обязательно для precise/approximate
  timeIntervalMinutes?: number;  // ширина интервала в минутах для approximate (30..240)
  location: {
    lat: number;          // широта в градусах
    lng: number;          // долгота в градусах
    timezone: string;     // IANA timezone, например "Europe/Moscow"
  };
}
```

### Выход

```typescript
interface NatalProfile {
  precisionMode: "precise" | "approximate" | "unknown";
  isDayChart: boolean;            // true если Солнце выше горизонта
  ascendant?: { longitude: number; sign: ZodiacSign };  // null для unknown
  houseSystem: "whole_sign_asc" | "whole_sign_sun";     // вторая для unknown
  
  planets: {
    Sun: PlanetState;
    Moon: PlanetState;
    Mercury: PlanetState;
    Venus: PlanetState;
    Mars: PlanetState;
    Jupiter: PlanetState;
    Saturn: PlanetState;
  };
  
  computedAt: string;             // ISO timestamp
  ephemerisLibVersion: string;    // версия использованной библиотеки
}

interface PlanetState {
  longitude: number;              // эклиптическая долгота 0..360
  sign: ZodiacSign;               // знак зодиака
  signDegree: number;             // 0..29.9999
  house: number;                  // 1..12
  isRetrograde: boolean;
  speed: number;                  // градусов в сутки
  
  // Эссенциальное достоинство (внутренняя добродетель)
  essentialDignity: {
    domicile: boolean;
    exaltation: boolean;
    triplicity: boolean;
    term: boolean;
    face: boolean;
    detriment: boolean;
    fall: boolean;
    peregrine: boolean;
    score: number;                // итог в баллах Лилли (-5..+11)
  };
  
  // Акцидентальное достоинство (внешняя сила действия)
  accidentalDignity: {
    houseScore: number;           // -5..+5
    motionScore: number;          // -5..+4 (ретро/прямое/быстрое)
    sunRelation: "cazimi" | "combust" | "under_beams" | "free";
    sunRelationScore: number;     // -5..+5
    conjunctionWithBenefic: boolean;
    besieged: boolean;            // в осаде между Марсом и Сатурном
    score: number;                // суммарный балл
  };
  
  // Бонус секты по Порфирию
  sectBonus: number;              // 0 или +2
  
  // Финальная сила (синтез всего выше)
  S_initial: number;              // 0..1
  
  // Гармоничность (отдельный параметр, не складывается с силой)
  harmoniousnessFactors: {
    bonifications: BonificationDetail[];
    maltreatments: MaltreatmentDetail[];
    rawScore: number;             // -25..+25 примерно
  };
  H_initial: number;              // -1..+1
}

type ZodiacSign = "Aries" | "Taurus" | "Gemini" | "Cancer" | "Leo" | "Virgo" 
                | "Libra" | "Scorpio" | "Sagittarius" | "Capricorn" | "Aquarius" | "Pisces";
```

## Алгоритм пошагово

### Шаг 0: Подготовка времени расчёта

```
Если timeMode == "precise":
    chartTime = parseLocalTime(birthData.time, location.timezone)
    
Если timeMode == "approximate":
    midpoint = parseLocalTime(birthData.time, location.timezone)
    chartTime = midpoint  // середина интервала, передана пользователем
    flags.uncertain_houses = true
    
Если timeMode == "unknown":
    chartTime = noonLocalTime(birthData.date, location.timezone)  // 12:00
    flags.no_houses = true
    flags.moon_uncertain = true  // погрешность Луны до ±6°
```

### Шаг 1: Получение астрономических позиций

Используем JS-библиотеку эфемерид. **Рекомендация:** `astronomia` (порт VSOP87) или `circular-natal-horoscope-js` (использует Moshier ephemeris). Точность: секунды дуги — этого более чем достаточно.

```
ephemeris = computeEphemeris(chartTime, location.lat, location.lng)
// для каждой из 7 планет: longitude, latitude, speed, isRetrograde
// для Солнца дополнительно: высота над горизонтом → isDayChart
// Асцендент → только если timeMode != "unknown"
```

### Шаг 2: Определение системы домов

```
Если timeMode != "unknown":
    houseSystem = "whole_sign_asc"
    house1Sign = signOf(ascendant.longitude)
    house[i].sign = signWithOffset(house1Sign, i-1)  // i=1..12
    
Если timeMode == "unknown":
    houseSystem = "whole_sign_sun"
    house1Sign = signOf(planets.Sun.longitude)
    house[i].sign = signWithOffset(house1Sign, i-1)
```

Для каждой планеты `planet.house = (signNumber(planet.sign) - signNumber(house1Sign) + 12) % 12 + 1`.

### Шаг 3: Определение секты карты

```
isDayChart = (sunAltitudeAtBirth > 0)
```

Если время неизвестно — берётся факт по полудню (Солнце почти всегда выше горизонта в полдень → дневная карта). Это создаёт небольшое смещение для людей, родившихся на самом деле ночью, но при отсутствии времени это разумный компромисс.

**Планеты секты:**
- Дневная карта: Солнце, Юпитер, Сатурн
- Ночная карта: Луна, Венера, Марс
- Меркурий — ситуативно: в секте, если он восточный (восходит до Солнца) для дневной карты или западный (заходит после Солнца) для ночной. Для упрощения — Меркурий всегда вне секты (не критично).

### Шаг 4: Расчёт эссенциального достоинства

Для каждой планеты:

```
score = 0

if planet in domicile_of(planet):     score += 5
if planet in exaltation_of(planet):   score += 4
if planet in triplicity_of(planet, isDayChart): score += 3
if planet in term_of(planet, signDegree):       score += 2
if planet in face_of(planet, signDegree):       score += 1

if planet in detriment_of(planet):    score -= 5
if planet in fall_of(planet):         score -= 4

// Перегрин: нет ни одного достоинства И нет дебилитации
if score == 0 and not (detriment or fall):
    score = -5
    isPeregrine = true

essentialDignity.score = score
```

#### Таблицы достоинств (фиксированные)

**Обители (Domicile):**
| Планета | Знак(и) |
|---|---|
| Солнце | Лев |
| Луна | Рак |
| Меркурий | Близнецы, Дева |
| Венера | Телец, Весы |
| Марс | Овен, Скорпион |
| Юпитер | Стрелец, Рыбы |
| Сатурн | Козерог, Водолей |

**Экзальтация (Exaltation):**
| Планета | Знак (град.) |
|---|---|
| Солнце | Овен (19°) |
| Луна | Телец (3°) |
| Меркурий | Дева (15°) |
| Венера | Рыбы (27°) |
| Марс | Козерог (28°) |
| Юпитер | Рак (15°) |
| Сатурн | Весы (21°) |

**Изгнание (Detriment) = знак напротив обители.**
**Падение (Fall) = знак напротив экзальтации.**

**Триплицитеты (по Доротею, день/ночь):**
| Стихия | Знаки | День | Ночь | Партнёр |
|---|---|---|---|---|
| Огонь | Овен, Лев, Стрелец | Солнце | Юпитер | Сатурн |
| Земля | Телец, Дева, Козерог | Венера | Луна | Марс |
| Воздух | Близнецы, Весы, Водолей | Сатурн | Меркурий | Юпитер |
| Вода | Рак, Скорпион, Рыбы | Венера | Марс | Луна |

Бонус +3 даётся, если планета является дневным управителем триплицитета и карта дневная (или ночным управителем при ночной карте). Партнёрский управитель в реализации можно пока не учитывать (упрощение).

**Термы (Egyptian terms):** статическая таблица 12 знаков × 5 термов. Привожу полностью в Приложении A в конце ТЗ.

**Фасы (халдейский порядок):** каждые 10° знака управляются планетой по порядку Сатурн—Юпитер—Марс—Солнце—Венера—Меркурий—Луна, начиная с Марса в 0° Овна.

### Шаг 5: Расчёт акцидентального достоинства

```
score = 0

// 5.1. Положение в доме (только если houses известны)
houseScore = 0
switch (planet.house):
    case 1, 10:    houseScore = +5
    case 4, 7, 11: houseScore = +4
    case 2, 5:     houseScore = +3
    case 9:        houseScore = +2
    case 3:        houseScore = +1
    case 6, 8:     houseScore = -2
    case 12:       houseScore = -5

// В режиме "unknown" используется houseSystem == "whole_sign_sun";
// баллы те же, но это «солнечные дома», не классические.
// В режиме "approximate" houseScore × 0.7 (поправка на возможную ошибку).
score += houseScore

// 5.2. Движение
if planet not in [Sun, Moon]:
    if planet.isRetrograde: score -= 5
    elif planet.speed > meanSpeed(planet) * 1.1: score += 2  // быстрое
    else: score += 4  // прямое нормальное

// 5.3. Отношение к Солнцу (только для не-Солнечных)
if planet != Sun:
    angleFromSun = abs(planet.longitude - sun.longitude)
    angleFromSun = min(angleFromSun, 360 - angleFromSun)
    
    if angleFromSun < 0.283:      // 17 угловых минут
        sunRelation = "cazimi"
        score += 5
    elif angleFromSun < 8.5:
        sunRelation = "combust"
        score -= 5
    elif angleFromSun < 17:
        sunRelation = "under_beams"
        score -= 4
    else:
        sunRelation = "free"

// 5.4. Соединение с бенефиком (≤5°)
for benefic in [Jupiter, Venus]:
    if abs(angularDistance(planet, benefic)) <= 5:
        score += 5
        conjunctionWithBenefic = true
        break  // не дублируем

// 5.5. Осада между Марсом и Сатурном
if isBesiegedBetween(planet, Mars, Saturn):
    score -= 5
    besieged = true

accidentalDignity.score = score
```

`isBesiegedBetween(P, M1, M2)`: проверяем, что планета P находится «между» двумя малефиками по эклиптике (один впереди, другой позади, оба в орбисе ≤10°).

### Шаг 6: Бонус секты

```
sectBonus = 0
if isDayChart and planet in [Sun, Jupiter, Saturn]:    sectBonus = 2
if not isDayChart and planet in [Moon, Venus, Mars]:   sectBonus = 2
```

### Шаг 7: Сборка S_initial

```
rawS = essentialDignity.score 
     + accidentalDignity.score 
     + sectBonus

// Нормализация в [0; 1]
// Эмпирический диапазон: rawS ∈ [-25; +25] в большинстве реальных карт
S_initial = clamp((rawS + 25) / 50, 0, 1)
```

Эту формулу можно тонко настроить, когда на боевых данных увидите распределение значений. Главное — что она монотонна и масштабирована.

### Шаг 8: Расчёт гармоничности H_initial

Это **отдельный** параметр, не складывающийся с силой. Считается через классические условия малтритмента и бонификации.

```
rawH = 0

// 8.1. Малтритменты (от Марса и Сатурна)
for malefic in [Mars, Saturn]:
    if planet == malefic: continue  // не штрафуем малефик аспектами от самого себя
    
    // Соединение ≤3°
    if angularDistance(planet, malefic) <= 3:
        penalty = -4
        if hasReception(malefic, planet): penalty *= 0.5  // рецепция смягчает
        if isMutualReception(malefic, planet): penalty *= 0.25
        if not isInSect(malefic): penalty *= 1.5  // вне секты — хуже
        rawH += penalty
    
    // Оппозиция в орбисе
    if isInAspect(planet, malefic, aspectType="opposition", orb=combinedOrb(planet, malefic)/2):
        penalty = -3
        // ... те же модерации
        rawH += penalty
    
    // Преодоление (квадрат "справа" — малефик в 10-м знаке от планеты)
    if isOvercomingByRightSquare(malefic, planet):
        penalty = -4
        // ... модерации
        rawH += penalty
    
    // Квадрат "слева"
    elif isInAspect(planet, malefic, aspectType="square"):
        penalty = -2
        // ... модерации
        rawH += penalty

// 8.2. Окружение/осада малефиками
if isBesiegedBetween(planet, Mars, Saturn):
    rawH -= 5

// 8.3. Состояние диспозитора (управителя знака планеты)
dispositor = rulerOf(planet.sign)
if dispositor in cadent_unprofitable_houses [6, 8, 12]:  // только если houses известны
    rawH -= 2
if dispositor.sunRelation == "combust":
    rawH -= 2

// 8.4. Бонификации (от Юпитера и Венеры)
for benefic in [Jupiter, Venus]:
    if planet == benefic: continue
    
    // Соединение ≤5°
    if angularDistance(planet, benefic) <= 5:
        bonus = +4
        if hasReception(benefic, planet): bonus *= 1.5
        if isInSect(benefic): bonus *= 1.3
        rawH += bonus
    
    // Трин в орбисе
    if isInAspect(planet, benefic, aspectType="trine"):
        rawH += 3 * sectMultiplier(benefic)
    
    // Секстиль
    if isInAspect(planet, benefic, aspectType="sextile"):
        rawH += 2 * sectMultiplier(benefic)
    
    // Преодоление бенефиком
    if isOvercomingByRightSquare(benefic, planet):
        rawH += 4
    
    // Окружение бенефиками
    if isBesiegedBetween(planet, Jupiter, Venus):
        rawH += 5

// 8.5. Поправка для режима "unknown" — Луна имеет погрешность ±6°
if precisionMode == "unknown" and (planet == Moon or aspect involves Moon):
    aspect_contributions_with_moon *= 0.5

// Нормализация в [-1; +1]
H_initial = clamp(rawH / 10, -1, 1)
```

#### Орбисы аспектов (по Лилли, моиетии)

| Планета | Полный орбис |
|---|---|
| Солнце | 15° |
| Луна | 12° |
| Меркурий, Венера, Марс | 7° |
| Юпитер, Сатурн | 9° |

Орбис аспекта между двумя планетами = `(orb1 + orb2) / 2`.

#### Рецепция

`hasReception(A, B)`: планета A находится в обители или экзальтации планеты B.

`isMutualReception(A, B)`: A в достоинстве B И одновременно B в достоинстве A.

#### Преодоление

`isOvercomingByRightSquare(A, B)`: планета A находится в 10-м знаке от B (т.е. квадратом «справа» по знакам, против хода зодиака). Это вычисляется по знакам, не по градусам:
```
signsBetween = (signNumber(A) - signNumber(B) + 12) % 12
// Если signsBetween == 9 (то есть A на 10-й позиции от B), это правый квадрат
```

## Финальная нормализация и валидация

```
NatalProfile = {
  precisionMode,
  isDayChart,
  ascendant: timeMode != "unknown" ? ascendant : undefined,
  houseSystem,
  planets: { ... 7 объектов PlanetState },
  computedAt: now(),
  ephemerisLibVersion
}

assert(0 <= S_initial <= 1) for all planets
assert(-1 <= H_initial <= 1) for all planets
```

## Приложение A: Таблица египетских термов

Каждый знак разделён на 5 неравных частей. Пример для Овна: 0°–6° Юпитер, 6°–12° Венера, 12°–20° Меркурий, 20°–25° Марс, 25°–30° Сатурн.

Полная таблица — это статический JSON-файл `egyptian_terms.json`, который должен быть включён в проект. Я даю его структуру, реальные значения нужно взять из любого источника (Птолемей, Доротей — они идентичны для египетских термов):

```json
{
  "Aries":     [["Jupiter",0,6],["Venus",6,12],["Mercury",12,20],["Mars",20,25],["Saturn",25,30]],
  "Taurus":    [["Venus",0,8],["Mercury",8,14],["Jupiter",14,22],["Saturn",22,27],["Mars",27,30]],
  "Gemini":    [["Mercury",0,6],["Jupiter",6,12],["Venus",12,17],["Mars",17,24],["Saturn",24,30]],
  "Cancer":    [["Mars",0,7],["Venus",7,13],["Mercury",13,19],["Jupiter",19,26],["Saturn",26,30]],
  "Leo":       [["Jupiter",0,6],["Venus",6,11],["Saturn",11,18],["Mercury",18,24],["Mars",24,30]],
  "Virgo":     [["Mercury",0,7],["Venus",7,17],["Jupiter",17,21],["Mars",21,28],["Saturn",28,30]],
  "Libra":     [["Saturn",0,6],["Mercury",6,14],["Jupiter",14,21],["Venus",21,28],["Mars",28,30]],
  "Scorpio":   [["Mars",0,7],["Venus",7,11],["Mercury",11,19],["Jupiter",19,24],["Saturn",24,30]],
  "Sagittarius":[["Jupiter",0,12],["Venus",12,17],["Mercury",17,21],["Saturn",21,26],["Mars",26,30]],
  "Capricorn": [["Mercury",0,7],["Jupiter",7,14],["Venus",14,22],["Saturn",22,26],["Mars",26,30]],
  "Aquarius":  [["Mercury",0,7],["Venus",7,13],["Jupiter",13,20],["Mars",20,25],["Saturn",25,30]],
  "Pisces":    [["Venus",0,12],["Jupiter",12,16],["Mercury",16,19],["Mars",19,28],["Saturn",28,30]]
}
```

## Приложение B: Тестовые кейсы для верификации

Реализация считается корректной, если на этих кейсах она даёт результаты в указанных диапазонах.

### Кейс 1: Сильный, гармоничный Юпитер
**Данные:** Юпитер в Раке (экзальтация), в 11-м доме дневной карты, в трине от Венеры, без аспектов от малефиков.
**Ожидание:** S_initial > 0.75, H_initial > 0.6

### Кейс 2: Слабый, дисгармоничный Сатурн
**Данные:** Сатурн в Овне (падение), в 12-м доме ночной карты (вне секты), в соединении с Марсом ≤3°, диспозитор (Марс) в 8-м доме.
**Ожидание:** S_initial < 0.3, H_initial < -0.5

### Кейс 3: Сильный Сатурн как «архитектор» (Чайковский-style)
**Данные:** Сатурн в Весах (экзальтация), в 10-м доме дневной карты, в рецепции с Венерой.
**Ожидание:** S_initial > 0.8, H_initial > 0.4. Это пример того, что «злая» планета может быть высоко гармоничной.

### Кейс 4: Режим Unknown
**Данные:** Любая дата, timeMode=unknown.
**Ожидание:** все 7 планет имеют рассчитанные S и H; ascendant отсутствует; houseSystem == "whole_sign_sun"; точность Луны помечена как сниженная во флагах.

### Кейс 5: Гармоничный Марс
**Данные:** Марс в Козероге (экзальтация), в 1-м доме ночной карты (в секте), в трине от Юпитера.
**Ожидание:** S_initial > 0.75, H_initial > 0.5. Демонстрирует, что природа планеты не определяет её гармоничность.

## Производительность

- Расчёт натальной карты: < 200 мс на средних мобильных устройствах.
- Размер `NatalProfile` JSON: 3–5 КБ.
- Кешируется в локальном хранилище приложения и в облачном профиле пользователя.

## Зависимости

- JS-библиотека эфемерид: `circular-natal-horoscope-js` (рекомендуется) или `astronomia` или `swisseph-wasm`.
- Библиотека работы с timezones: `luxon` или `date-fns-tz`.
- Никаких сетевых вызовов — всё считается локально.

## Что НЕ делает этот модуль

- Не учитывает Уран, Нептун, Плутон, лунные узлы, Хирон, астероиды.
- Не считает прогрессии, дирекции, ревалюции.
- Не работает с транзитами — это задача M2.
- Не интерпретирует данные текстом — это задача M4.
