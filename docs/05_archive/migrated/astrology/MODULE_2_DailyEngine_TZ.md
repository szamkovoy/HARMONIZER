# MODULE 2: DAILY-ENGINE — Техническое задание

## Назначение

Модуль ежедневно (а точнее — при первом открытии приложения в новый день) определяет:
1. Importance каждой натальной планеты на сегодня.
2. Главную планету дня (с учётом стека последних двух).
3. Три «окна возможностей» — точные времена, когда практика особенно эффективна.

Все расчёты выполняются на клиенте, без обращения к серверу.

## Контракт данных

### Вход

```typescript
interface DailyEngineInput {
  natalProfile: NatalProfile;           // из M1
  calibration: Calibration | null;      // из M3, опционально (если null — используем S_initial, H_initial)
  
  forecastDate: string;                 // ISO date "2026-04-28" — день, на который считаем
  userLocation: {                       // текущая локация пользователя (не место рождения!)
    lat: number;
    lng: number;
    timezone: string;                   // IANA, например "Europe/Prague"
  };
  
  recentPlanetsOfDay: Planet[];         // стек последних 2 рекомендованных планет, [день-1, день-2]
}
```

### Выход

```typescript
interface DailyForecast {
  date: string;
  
  importance: {
    Sun: number;
    Moon: number;
    Mercury: number;
    Venus: number;
    Mars: number;
    Jupiter: number;
    Saturn: number;
  };
  
  // Активация (отдельно от Importance, для аналитики и UI)
  activation: { /* по тем же планетам */ };
  
  rankedPlanets: Planet[];              // отсортированы по убыванию Importance
  
  planetOfTheDay: Planet;               // главная планета дня (с учётом стека)
  isAlternativeChoice: boolean;         // true если первая отброшена из-за повторений 3 дня подряд
  alternativeReasonText?: string;       // текст для пользователя если isAlternativeChoice=true
  
  todayPlanetState: {
    naturalHarmoniousness: number;      // H_initial (или H_calibrated) этой планеты
    todayTone: "harmonic" | "neutral" | "dissonant";  // тональность переживания
  };
  
  windowsOfOpportunity: {
    sunrise: { time: string; planet: Planet } | null;       // ISO datetime в TZ пользователя
    culmination: { time: string; planet: Planet } | null;
    exactAspect: { time: string; aspectType: AspectType; toNatalPlanet: Planet } | null;
  };
  
  // Сырые данные транзитной карты на 14:00 локального времени
  transitChart: {
    referenceTime: string;              // "2026-04-28T14:00:00+02:00"
    planets: { /* longitudes 7 планет */ };
  };
  
  computedAt: string;
  cacheValidUntil: string;              // ISO datetime — конец сегодняшнего дня в TZ пользователя
}

type AspectType = "conjunction" | "opposition" | "square" | "trine" | "sextile";
type Planet = "Sun" | "Moon" | "Mercury" | "Venus" | "Mars" | "Jupiter" | "Saturn";
```

## Алгоритм пошагово

### Шаг 0: Кеширование

Перед расчётом проверяем кеш в локальном хранилище. Если есть `DailyForecast` с `date == forecastDate` и `cacheValidUntil > now()` — возвращаем из кеша. Кеш инвалидируется при смене даты или при обновлении калибровки.

### Шаг 1: Подготовка эталонного времени транзитной карты

```
referenceTime = makeLocalDateTime(forecastDate, "14:00", userLocation.timezone)
```

14:00 локального времени — компромисс между утром и вечером, когда большинство пользователей бодрствуют. Это эталон для всех планет, КРОМЕ Луны (для неё считаем динамически в Шаге 7).

### Шаг 2: Получение транзитных позиций планет

```
transitEphemeris = computeEphemeris(referenceTime, userLocation.lat, userLocation.lng)
// 7 долгот, скорости, isRetrograde
```

### Шаг 3: Эффективные натальные параметры (учёт калибровки)

```
for each planet:
    if calibration != null:
        S_eff[planet] = calibration.S_calibrated[planet]
        H_eff[planet] = calibration.H_calibrated[planet]
    else:
        S_eff[planet] = natalProfile.planets[planet].S_initial
        H_eff[planet] = natalProfile.planets[planet].H_initial
```

### Шаг 4: Расчёт активации каждой натальной планеты

Это центральная формула модуля.

```
for each natalPlanet P in [Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn]:
    A[P] = 0
    
    for each transitPlanet T in [Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn]:
        // Находим аспект
        aspect = findAspect(transit[T].longitude, natal[P].longitude)
        if aspect == null: continue
        
        // 4 множителя
        aspectCoef = ASPECT_COEF[aspect.type]
        orbCloseness = max(0, 1 - aspect.orb / aspect.maxOrb)
        applyingMul = aspect.isApplying ? 1.2 : 0.8
        transitWeight = TRANSIT_WEIGHT[T]
        sameBodyBonus = (T == P) ? (aspect.type == "conjunction" ? 1.5 : 1.3) : 1.0
        
        contribution = aspectCoef * orbCloseness * applyingMul * transitWeight * sameBodyBonus
        
        // Поправка для unknown-режима
        if natalProfile.precisionMode == "unknown":
            if T == "Moon" or P == "Moon":
                contribution *= 0.5
        
        A[P] += contribution
```

#### Константы

**ASPECT_COEF (сила связи):**
| Тип аспекта | Коэф. |
|---|---|
| Соединение (conjunction) | 1.0 |
| Оппозиция (opposition) | 0.9 |
| Квадрат (square) | 0.8 |
| Трин (trine) | 0.7 |
| Секстиль (sextile) | 0.5 |

Замечание: квадрат стоит выше трина потому, что это «громкий», активирующий аспект. Качество переживания (комфорт/напряжение) учтено отдельно через H.

**TRANSIT_WEIGHT (вес транзитной планеты):**
| Транзитная планета | Вес |
|---|---|
| Сатурн | 1.0 |
| Юпитер | 0.9 |
| Марс | 0.8 |
| Солнце | 0.7 |
| Венера | 0.5 |
| Меркурий | 0.5 |
| Луна | 0.3 |

**Орбисы для транзитных аспектов** (узкие, чтобы не сваливать всё в кучу):
| Тип аспекта | Макс. орб |
|---|---|
| Соединение, оппозиция | 6° |
| Квадрат, трин | 5° |
| Секстиль | 3° |

#### Определение аспекта `findAspect(lon1, lon2)`

```
delta = abs(lon1 - lon2)
delta = min(delta, 360 - delta)  // короткая дуга

candidates = [
    (conjunction, 0, 6),
    (opposition, 180, 6),
    (trine, 120, 5),
    (square, 90, 5),
    (sextile, 60, 3)
]

for (type, exactAngle, maxOrb) in candidates:
    orb = abs(delta - exactAngle)
    if orb <= maxOrb:
        return { type, orb, maxOrb, isApplying: ... }

return null
```

#### Определение `isApplying`

Аспект сходящийся, если орб уменьшается с течением времени. Для двух планет с долготами `lon1, lon2` и скоростями `v1, v2`:

```
// быстрая планета приближается к точному аспекту, если разница скоростей такова,
// что её положение через час окажется ближе к точному аспекту, чем сейчас
deltaIn1Hour = compute orb at (referenceTime + 1 hour)
isApplying = deltaIn1Hour < currentOrb
```

В большинстве случаев натальная планета неподвижна (она зафиксирована в карте), а транзитная движется. Поэтому: если транзитная планета прямая и движется к точному аспекту — applying; если ретро или уже прошла точку — separating.

### Шаг 5: Расчёт Importance

```
for each planet P:
    Importance[P] = A[P] * (0.5 + 0.5 * S_eff[P])
```

Логика: даже минимально активная планета с очень сильной натальной позицией даст заметное переживание; и наоборот, мощно активированная слабая планета чувствуется приглушённо. Множитель никогда не падает ниже 0.5, чтобы слабые натальные планеты тоже могли иметь свой день.

### Шаг 6: Выбор планеты дня (с учётом стека)

```
ranked = sortDescending(Importance)
firstChoice = ranked[0].planet

// Проверка стека: если 2 предыдущих дня была одна и та же планета,
// и сегодня снова она же — берём вторую
if recentPlanetsOfDay.length == 2 
   and recentPlanetsOfDay[0] == firstChoice 
   and recentPlanetsOfDay[1] == firstChoice:
    
    planetOfTheDay = ranked[1].planet
    isAlternativeChoice = true
    alternativeReasonText = "Сегодня предлагаем направить внимание на другую тему — " 
                            + getChakraName(planetOfTheDay) 
                            + ". Это разнообразит ваши усилия по гармонизации."
else:
    planetOfTheDay = firstChoice
    isAlternativeChoice = false
```

### Шаг 7: Тональность дня

```
H = H_eff[planetOfTheDay]

if H > 0.3:    todayTone = "harmonic"
elif H < -0.3: todayTone = "dissonant"
else:          todayTone = "neutral"
```

### Шаг 8: Окна возможностей

Это три отдельных астрономических расчёта для главной транзитной планеты, которая создаёт главный аспект к натальной планете дня. Если таких транзитных аспектов несколько — берём с наибольшим вкладом в `A[planetOfTheDay]`.

```
mainTransitPlanet = ... планета T, которая дала максимальный вклад в активацию planetOfTheDay
mainTransitAspect = ... тип аспекта (conjunction/square/...)
```

#### 8.1. Восход (sunrise — общий астрономический термин для любой планеты)

Момент, когда `mainTransitPlanet` пересекает восточный горизонт в `userLocation`.

Используем библиотеку астрономии (`astronomia`, `suncalc` для Солнца/Луны). Для других планет — `astronomia.parallactic` или аналог. На вход: дата, lat, lng, текущее положение и скорость планеты.

```
sunrise.time = computeRiseTime(mainTransitPlanet, forecastDate, userLocation)
sunrise.planet = mainTransitPlanet
```

Если планета сегодня не восходит (полярные широты, циркумполярность) — поле `null`.

#### 8.2. Кульминация (culmination)

Момент, когда `mainTransitPlanet` пересекает южный меридиан (находится в зените локально).

```
culmination.time = computeMeridianTransitTime(mainTransitPlanet, forecastDate, userLocation)
culmination.planet = mainTransitPlanet
```

#### 8.3. Точный аспект

Момент, когда орб аспекта между `mainTransitPlanet` и `natal[planetOfTheDay]` становится равным 0°. Только если этот момент попадает в текущие сутки в TZ пользователя.

```
exactAspect.time = computeExactAspectTime(
    mainTransitPlanet, 
    natal[planetOfTheDay].longitude,
    mainTransitAspect.type,
    forecastDate
)
exactAspect.aspectType = mainTransitAspect.type
exactAspect.toNatalPlanet = planetOfTheDay
```

Если точный аспект в эти сутки не достигается (например, ретроградная планета не дойдёт до точки) — поле `null`.

#### Замечание о точности для Луны

Если `mainTransitPlanet == Moon`, для расчётов восхода и точного аспекта **нельзя** использовать положение Луны на 14:00 — она движется ~13°/сутки. В этом случае:

```
// Итеративное уточнение для Луны
1. Грубая оценка по позиции на 14:00.
2. Пересчёт эфемерид для оценочного момента.
3. Уточнение времени.
4. Повторить 2-3 пока сходимость не станет < 1 минуты.
```

Для остальных планет (≤1°/сутки) хватает позиции на 14:00.

### Шаг 9: Сборка результата

```
return DailyForecast {
  date: forecastDate,
  importance: { ... все 7 },
  activation: { ... все 7 },
  rankedPlanets: ranked.map(r => r.planet),
  planetOfTheDay,
  isAlternativeChoice,
  alternativeReasonText,
  todayPlanetState: {
    naturalHarmoniousness: H_eff[planetOfTheDay],
    todayTone
  },
  windowsOfOpportunity: { sunrise, culmination, exactAspect },
  transitChart: { referenceTime, planets: transitEphemeris },
  computedAt: now(),
  cacheValidUntil: endOfDayInUserTimezone
}
```

### Шаг 10: Обновление стека

После того как пользователь увидел рекомендацию, обновляется стек последних планет дня:

```
recentPlanetsOfDay = [planetOfTheDay, recentPlanetsOfDay[0]]
// (отбрасываем самую старую, текущая встаёт в начало)
```

**Важно:** обновлять стек только после реального показа пользователю, не при каждом расчёте. Если пользователь не открывал приложение 5 дней, стек должен содержать те планеты, которые были выбраны в моменты последних показов, а не для всех пропущенных дней.

## Поведение в режимах точности

| Режим | Что меняется |
|---|---|
| **Precise** | Стандартный алгоритм. |
| **Approximate** | Активация Луны умножается на 0.7 (более широкий орбис, неточная позиция). Окна возможностей считаются как обычно (текущая локация известна точно). |
| **Unknown** | Активация Луны умножается на 0.5. Окна возможностей считаются нормально. |

## Производительность и нагрузка

- Полный расчёт `DailyForecast`: < 100 мс на средних устройствах (без учёта эфемерид окон возможностей).
- Окна возможностей с итерациями для Луны: ещё ~50–100 мс.
- Итого: < 250 мс. Один раз в сутки, плюс при ручном пересчёте.
- Размер `DailyForecast` JSON: ~2 КБ.
- Кеш в локальном хранилище.

## Тестовые кейсы

### Кейс 1: Соединение транзитного Сатурна с натальным Сатурном
**Условия:** транзитный Сатурн в орбисе 1° от натального, остальные транзиты слабые.
**Ожидание:** planetOfTheDay = Saturn, A[Saturn] доминирует, sameBodyBonus применён, mainTransitPlanet = Saturn.

### Кейс 2: Транзитная Луна в трине к натальной Венере, ничего более
**Условия:** все остальные транзиты вне орбисов значимых аспектов.
**Ожидание:** planetOfTheDay = Venus (несмотря на то, что вес Луны всего 0.3, других сигналов нет). Окна возможностей считаются для Луны с итеративным уточнением.

### Кейс 3: Альтернативный выбор
**Условия:** recentPlanetsOfDay = [Mars, Mars]; сегодня снова Importance максимален у Mars.
**Ожидание:** planetOfTheDay = ranked[1], isAlternativeChoice = true, текст с объяснением.

### Кейс 4: Низкая ось активаций
**Условия:** транзитная карта сегодня даёт слабые аспекты (день «между событиями»).
**Ожидание:** все Importance низкие, но всё равно выбирается один максимум — день «фоновой темы».

### Кейс 5: Гармоничный vs дисгармоничный тон
**Условия 1:** planetOfTheDay = Jupiter, H_eff[Jupiter] = +0.7. → todayTone = "harmonic"
**Условия 2:** planetOfTheDay = Saturn, H_eff[Saturn] = -0.6. → todayTone = "dissonant"

### Кейс 6: Циркумполярность
**Условия:** пользователь на широте 70° зимой, mainTransitPlanet = Sun, день полярной ночи.
**Ожидание:** sunrise = null, culmination = null (или с признаком "никогда не виден"), но exactAspect считается нормально.

## Зависимости

- JS-библиотека эфемерид (та же, что в M1).
- `astronomia` или `suncalc` для расчёта восхода/кульминации (для Солнца и Луны достаточно `suncalc`; для остальных планет — `astronomia` методы `parallactic`, `nearest`).
- `luxon` или `date-fns-tz` для работы с timezones.

## Что НЕ делает этот модуль

- Не работает с долгосрочными прогнозами (только сегодня).
- Не отображает данные пользователю (это задача GUI).
- Не выбирает практику (это задача M4).
- Не записывает результаты в историю — это делает приложение поверх (например, после того как пользователь увидит рекомендацию).
