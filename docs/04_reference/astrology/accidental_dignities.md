# Акцидентальное достоинство

## Шаг 5: Расчёт акцидентального достоинства

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

## Шаг 6: Бонус секты

```
sectBonus = 0
if isDayChart and planet in [Sun, Jupiter, Saturn]:    sectBonus = 2
if not isDayChart and planet in [Moon, Venus, Mars]:   sectBonus = 2
```
