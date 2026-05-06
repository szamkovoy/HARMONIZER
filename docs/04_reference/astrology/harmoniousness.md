# Сборка S_initial и гармоничность H_initial

## Шаг 7: Сборка S_initial

```
rawS = essentialDignity.score
     + accidentalDignity.score
     + sectBonus

// Нормализация в [0; 1]
// Эмпирический диапазон: rawS ∈ [-25; +25] в большинстве реальных карт
S_initial = clamp((rawS + 25) / 50, 0, 1)
```

Эту формулу можно тонко настроить, когда на боевых данных увидите распределение значений. Главное — что она монотонна и масштабирована.

## Шаг 8: Расчёт гармоничности H_initial

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

### Орбисы аспектов (по Лилли, моиетии)

| Планета | Полный орбис |
|---|---|
| Солнце | 15° |
| Луна | 12° |
| Меркурий, Венера, Марс | 7° |
| Юпитер, Сатурн | 9° |

Орбис аспекта между двумя планетами = `(orb1 + orb2) / 2`.

### Рецепция

`hasReception(A, B)`: планета A находится в обители или экзальтации планеты B.

`isMutualReception(A, B)`: A в достоинстве B И одновременно B в достоинстве A.

### Преодоление

`isOvercomingByRightSquare(A, B)`: планета A находится в 10-м знаке от B (т.е. квадратом «справа» по знакам, против хода зодиака). Это вычисляется по знакам, не по градусам:

```
signsBetween = (signNumber(A) - signNumber(B) + 12) % 12
// Если signsBetween == 9 (то есть A на 10-й позиции от B), это правый квадрат
```
