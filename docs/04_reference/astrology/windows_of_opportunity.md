# Окна возможностей

## Шаг 8: Окна возможностей

Это три отдельных астрономических расчёта для главной транзитной планеты, которая создаёт главный аспект к натальной планете дня. Если таких транзитных аспектов несколько — берём с наибольшим вкладом в `A[planetOfTheDay]`.

```
mainTransitPlanet = ... планета T, которая дала максимальный вклад в активацию planetOfTheDay
mainTransitAspect = ... тип аспекта (conjunction/square/...)
```

### 8.1. Восход (sunrise — общий астрономический термин для любой планеты)

Момент, когда `mainTransitPlanet` пересекает восточный горизонт в `userLocation`.

Используем библиотеку астрономии (`astronomia`, `suncalc` для Солнца/Луны). Для других планет — `astronomia.parallactic` или аналог. На вход: дата, lat, lng, текущее положение и скорость планеты.

```
sunrise.time = computeRiseTime(mainTransitPlanet, forecastDate, userLocation)
sunrise.planet = mainTransitPlanet
```

Если планета сегодня не восходит (полярные широты, циркумполярность) — поле `null`.

### 8.2. Кульминация (culmination)

Момент, когда `mainTransitPlanet` пересекает южный меридиан (находится в зените локально).

```
culmination.time = computeMeridianTransitTime(mainTransitPlanet, forecastDate, userLocation)
culmination.planet = mainTransitPlanet
```

### 8.3. Точный аспект

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

### Замечание о точности для Луны

Если `mainTransitPlanet == Moon`, для расчётов восхода и точного аспекта **нельзя** использовать положение Луны на 14:00 — она движется ~13°/сутки. В этом случае:

```
// Итеративное уточнение для Луны
1. Грубая оценка по позиции на 14:00.
2. Пересчёт эфемерид для оценочного момента.
3. Уточнение времени.
4. Повторить 2-3 пока сходимость не станет < 1 минуты.
```

Для остальных планет (≤1°/сутки) хватает позиции на 14:00.
