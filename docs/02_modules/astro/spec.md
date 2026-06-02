---
id: 02_modules/astro/spec
title: Astro Spec
version: 1.4
updated: 2026-06-02
depends_on: [01_foundation/architecture, 02_modules/infra/spec]
code_refs:
  [
    modules/astro-core/index.ts,
    modules/astro-core/computeNatalProfile.ts,
    modules/astro-core/ephemeris.ts,
    modules/astro-core/core/types.ts,
    _legacy_web/app/api/astro/natal/route.ts,
    _legacy_web/app/api/_utils/astro-db.ts,
    services/natalProfileClient.ts,
    _legacy_web/app/api/astro/daily-forecast/route.ts,
    supabase/functions/daily-forecast/index.ts,
  ]
---

## 1. Назначение

Модуль **astro** задаёт натальный профиль пользователя (позиции семи планет, дома whole sign, эссенциальное и акцидентальное достоинство, стартовые `S_initial` и `H_initial` для каждой планеты). Эти значения считаются при сохранении данных рождения и дальше читаются из кэша в Supabase; они служат базой для дневного прогноза (активация, важность) и для калибровки, которая добавляет отдельные `S_calibrated` / `H_calibrated`, не перезаписывая исходные поля в строке натала.

## 2. Публичный контракт

Публичный API пакета `modules/astro-core` (импорт `@/modules/astro-core` в приложении, тот же модуль подключается из `_legacy_web` для API routes).

**Функции и классы**

- `computeNatalProfile(birthData: BirthData, ephemerisProvider: EphemerisProvider): Promise<NatalProfile>` — полный конвейер: валидация `BirthData`, вызов провайдера эфемерид, расчёт достоинств и `S_initial` / `H_initial`.
- `computeNatalProfileFromPositions(params: { precisionMode: BirthData["timeMode"]; chart: ChartPositions }): NatalProfile` — детерминированный расчёт профиля по уже готовым долготам (тесты, фикстуры, повторное использование кэшированных позиций).
- `interface EphemerisProvider { computeNatalChart(input: BirthData): Promise<ChartPositions> | ChartPositions }`
- `class AstronomiaEphemerisProvider implements EphemerisProvider` — реализация на библиотеке `astronomia` (VSOP87 для планет, отдельные модели для Солнца и Луны).
- `computeNatalProfileWithAstronomia(birthData: BirthData): Promise<NatalProfile>` — обёртка над `computeNatalProfile(..., new AstronomiaEphemerisProvider())`.
- Вспомогательные экспорты для продвинутых сценариев и тестов: `eclipticLongitudeForPlanetAt`, `equatorialForPlanetAt`, `positionForPlanetAt`, `computeEssentialDignity`, `computeAccidentalDignity`, `computeHarmoniousness`, `faceRulerOf`, `termRulerOf`, константы `PLANETS_7`, `ZODIAC_SIGNS`.

**Типы (канон — `modules/astro-core/core/types.ts`)**

```ts
export type Planet = "Sun" | "Moon" | "Mercury" | "Venus" | "Mars" | "Jupiter" | "Saturn";

export type ZodiacSign =
  | "Aries"
  | "Taurus"
  | "Gemini"
  | "Cancer"
  | "Leo"
  | "Virgo"
  | "Libra"
  | "Scorpio"
  | "Sagittarius"
  | "Capricorn"
  | "Aquarius"
  | "Pisces";

export type PrecisionMode = "precise" | "approximate" | "unknown";

export interface BirthData {
  date: string;
  timeMode: PrecisionMode;
  time?: string;
  timeIntervalMinutes?: number;
  location: {
    lat: number;
    lng: number;
    timezone: string;
  };
}

export interface PlanetState extends PlanetPosition {
  sign: ZodiacSign;
  signDegree: number;
  house: number;
  essentialDignity: EssentialDignity;
  accidentalDignity: AccidentalDignity;
  sectBonus: number;
  S_initial: number;
  harmoniousnessFactors: {
    bonifications: BonificationDetail[];
    maltreatments: MaltreatmentDetail[];
    rawScore: number;
  };
  H_initial: number;
}

export interface NatalProfile {
  precisionMode: PrecisionMode;
  isDayChart: boolean;
  ascendant?: { longitude: number; sign: ZodiacSign };
  houseSystem: HouseSystem;
  houseCusps?: number[];
  planets: Record<Planet, PlanetState>;
  computedAt: string;
  ephemerisLibVersion: string;
}
```

Типы `PlanetPosition`, `ChartPositions`, `EssentialDignity`, `AccidentalDignity`, `HouseSystem`, детали аспектов и списков бонификаций — в том же файле типов; методика баллов и орбисов описана в **Справочных материалах**, не в этом spec.

**Клиентский контракт сохранения натала**

- `services/natalProfileClient.ts`: `createNatalProfile(birthData, signal?)` — `POST` на `getAstroNatalUrl()` (Vercel `_legacy_web/app/api/astro/natal`) с телом `{ birthData }` и JWT Supabase; ответ содержит `profile: NatalProfile` и опционально `natalChart` (строка БД).
- `fetchActiveNatalProfile()` — чтение активной строки из `user_natal_charts` через клиентский Supabase SDK и сборка `NatalProfile` (включая восстановление `houseCusps` для `precise` при наличии `ascendant_longitude`); клиентский запрос защищён таймаутом `10s` через `AbortController` + PostgREST `.abortSignal(...)`.
- `fetchActiveNatalProfileCached(userId, options?)` — mobile/web helper для UI карты на Home: при наличии **непустого** локального кэша (`expo-secure-store` / `localStorage`, ключ `harmonizer.natalProfile.v1.{userId}`) сразу возвращает его и в фоне обновляет из сети; опциональный `options.onBackgroundRefresh` вызывается после завершения background refresh. Запись кэша с `profile: null` при чтении сбрасывается (не short-circuit), сетевые сбои **не** персистятся как «нет карты». При отсутствии валидного кэша ждёт сетевой fetch. Запуск персонального прогноза на Home **не** зависит от успеха этого helper — gate по `users.birth_date` (см. `daily_forecast`).

## 3. Внутренняя архитектура

- **Расчёт при сохранении:** мобильный клиент не считает эфемериды сам. Он отправляет `BirthData` на серверный маршрут `POST /api/astro/natal`, который в Node вызывает `computeNatalProfileWithAstronomia`, затем пишет результат в `user_natal_charts` (service role), деактивирует предыдущую активную версию, обновляет поля рождения в `users` и инвалидирует кэш `user_daily_forecasts` с текущей локальной даты (`todayLocalDate`).
- **Библиотека ядра:** вся астрологическая математика (дома, достоинства, гармоничность, нормализация `S_initial`/`H_initial`) живёт в `modules/astro-core` и общая для сервера и тестов; эфемериды инжектируются через `EphemerisProvider`, единственная продакшен-реализация — `AstronomiaEphemerisProvider` в `ephemeris.ts`.
- **Потребление кэша:** `_legacy_web/app/api/_utils/astro-db.ts` (`natalProfileFromRow`, `loadActiveNatalProfile`) и зеркальная логика в `natalProfileClient.ts` приводят строку БД к типу `NatalProfile`. На клиенте `fetchActiveNatalProfileCached` хранит последнюю активную карту локально и обновляет запись после успешного `createNatalProfile`. Дневной прогноз (Next.js и Supabase Edge) и ассистент загружают тот же срез полей.
- **Связь с прогнозом:** модуль `daily_forecast` импортирует типы и использует `natalProfile.planets` в движке активации и важности; см. `modules/daily-engine/core/activation.ts`.

## 4. Конфигурация и параметры

- **Эфемериды:** npm-пакет `astronomia` (см. импорты в `ephemeris.ts`). Версия для трассировки зашита константой `EPHEMERIS_LIB_VERSION = "astronomia@4.2.0"`; она попадает в `ChartPositions.ephemerisLibVersion` и далее в `NatalProfile` и колонку `ephemeris_lib_version` в БД. Долгота Солнца: `solar.apparentLongitude(base.J2000Century(jde))` (не сырой JDE) — та же формула в зеркалах `modules/astro-core/ephemeris.ts`, `_legacy_web/modules/astro-core/ephemeris.ts`, `supabase/functions/_shared/dailyForecast.ts`, `_legacy_web/app/api/_utils/globalTransitMath.ts`.
- **Режимы точности `timeMode`:**
  - **`precise`** — локальные дата и время из `birthData`, считается асцендент и куспиды whole sign от асцендента; `houseSystem`: `whole_sign_asc`; массив `houseCusps` присутствует в профиле.
  - **`approximate`** — для эфемерид используется то же локальное время, что передал клиент (валидируется наличие `time`); `houseSystem`: `whole_sign_asc`; `houseCusps` в профиле **не** заполняются (см. `wholeSignCusps` в `computeNatalProfile.ts`). Балл домов в акцидентальном достоинстве умножается на `0.7` (`accidentalDignity.ts`). В транзитном движке при активации участия Луны применяется дополнительный множитель `0.7` (`activation.ts`).
  - **`unknown`** — момент карты фиксируется как полдень локальной зоны (`12:00`), асцендент в эфемеридах не считается; `houseSystem`: `whole_sign_sun` (дома от знака Солнца); поле `ascendant` в `NatalProfile` отсутствует. В гармоничности и активации для аспектов с Луной действует ослабление (см. код `harmoniousness.ts`, `activation.ts`).
- **`timeIntervalMinutes`:** диапазон `30..240` валидируется для `approximate`, но **на момент миграции не участвует** в выборе момента времени карты (в отличие от описания в историческом ТЗ).

## 5. Известные ограничения

- Натальный профиль **не** пересчитывается по расписанию; обновление только при успешном вызове сохранения (новый `birthData`).
- Калибровка не изменяет JSON `planets` в `user_natal_charts`: скорректированные величины живут в `user_calibrations` и подмешиваются в прогноз через `effectiveNatalParams` в daily-engine.
- Расчёт завязан на Node/Vercel для маршрута натала; клиентский бандл использует те же типы и клиент для чтения/записи, но не обязан тянуть тяжёлые эфемериды.
- Подписка (`subscription`) не ветвит логику astro по тарифу в коде ядра; ограничения доступа к персональному прогногу задаются на уровне home/profile, а не внутри `astro-core`.

## Справочные материалы

- docs/04_reference/astrology/essential_dignities.md
- docs/04_reference/astrology/accidental_dignities.md
- docs/04_reference/astrology/harmoniousness.md
- docs/04_reference/astrology/activation_and_importance.md
- docs/04_reference/astrology/windows_of_opportunity.md
