# Активация и Importance

## Шаг 4: Расчёт активации каждой натальной планеты

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

### Константы

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

### Определение аспекта `findAspect(lon1, lon2)`

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

### Определение `isApplying`

Аспект сходящийся, если орб уменьшается с течением времени. Для двух планет с долготами `lon1, lon2` и скоростями `v1, v2`:

```
// быстрая планета приближается к точному аспекту, если разница скоростей такова,
// что её положение через час окажется ближе к точному аспекту, чем сейчас
deltaIn1Hour = compute orb at (referenceTime + 1 hour)
isApplying = deltaIn1Hour < currentOrb
```

В большинстве случаев натальная планета неподвижна (она зафиксирована в карте), а транзитная движется. Поэтому: если транзитная планета прямая и движется к точному аспекту — applying; если ретро или уже прошла точку — separating.

## Шаг 5: Расчёт Importance

```
for each planet P:
    Importance[P] = A[P] * (0.5 + 0.5 * S_eff[P])
```

Логика: даже минимально активная планета с очень сильной натальной позицией даст заметное переживание; и наоборот, мощно активированная слабая планета чувствуется приглушённо. Множитель никогда не падает ниже 0.5, чтобы слабые натальные планеты тоже могли иметь свой день.
