# PATCH 4 [P1]: Устранение дублирования Daily-Engine между Node и Deno

## Что не так

Согласно аудиту:

> Полная копия цепочки `effectiveNatalParams → activation → importance` живёт в `supabase/functions/_shared/dailyForecast.ts` (стр. ~145–281): формула совпадает с модулем (`activation * (0.5 + 0.5 * S_eff)`), но это второй исходник; при изменении M2 в `modules/daily-engine` Deno-версию легко забыть обновить.

Имеем две независимые реализации одной формулы:
1. **Node-модуль:** `modules/daily-engine/core/activation.ts` — `effectiveNatalParams`, `computeImportance`.
2. **Deno-копия:** `supabase/functions/_shared/dailyForecast.ts` — те же функции inline.

Это **долгосрочный риск дрейфа констант**. Если я обновлю формулу в ТЗ — Cursor поменяет одну версию, забудет вторую. Через 3 месяца будут расхождения, которые трудно отловить.

## Решение: единый источник истины через ESM-import из Deno

Supabase Edge Functions работают на Deno. Deno умеет импортировать ESM-модули по URL или файловому пути. Можно сделать общий пакет, который читают **обе** среды:

### Вариант 1 (рекомендую): TypeScript-источник + два бандла

```
modules/
├── daily-engine-core/                  # ИСТОЧНИК ИСТИНЫ
│   ├── activation.ts                   # без Node-зависимостей!
│   ├── importance.ts
│   ├── types.ts
│   ├── constants.ts                    # ASPECT_COEF, TRANSIT_WEIGHT, и т.д.
│   ├── index.ts                        # public API
│   └── package.json                    # type: "module"
│
modules/
├── daily-engine/                       # Node-обёртка (использует daily-engine-core)
│   ├── computeDailyForecast.ts         # импорт из daily-engine-core
│   ├── ephemeris.ts                    # Node-specific
│   └── ...
│
supabase/functions/
├── _shared/
│   ├── daily-engine-deno.ts            # Re-export из daily-engine-core
│   └── ephemeris-deno.ts               # Deno-specific эфемериды
```

**Ключевое:** `daily-engine-core/` содержит **только чистую логику** без I/O, без зависимостей от Node API (`fs`, `process`, `Buffer`). Тогда Deno импортирует напрямую:

```typescript
// supabase/functions/_shared/daily-engine-deno.ts

// Прямой relative-path импорт из источника
export {
  effectiveNatalParams,
  computeImportance,
  computeActivation,
  ASPECT_COEF,
  TRANSIT_WEIGHT,
} from "../../../modules/daily-engine-core/index.ts";
```

Для этого Deno должен видеть путь. В `supabase/config.toml` можно настроить, либо использовать import map.

### Вариант 2 (быстрее, но временно): жёсткий тест на расхождение

Если переезд на shared core слишком радикален для текущего этапа — можно как минимум **добавить тест-страж**, который ловит дрейф формулы:

```typescript
// supabase/functions/_shared/daily-engine-parity.test.ts

import { describe, it, expect } from "vitest";
import { computeImportance as nodeImportance, effectiveNatalParams as nodeEffective } from "@/modules/daily-engine/core/activation";
import { computeImportance as denoImportance, effectiveNatalParams as denoEffective } from "../supabase/functions/_shared/dailyForecast";

describe("Daily-Engine parity: Node vs Deno", () => {
  it("computeImportance produces identical results", () => {
    const activation = { Sun: 0.5, Moon: 0.3, Mercury: 0.2, Venus: 0.1, Mars: 0.4, Jupiter: 0.6, Saturn: 0.7 };
    const sEff = { Sun: 0.8, Moon: 0.5, Mercury: 0.3, Venus: 0.4, Mars: 0.6, Jupiter: 0.9, Saturn: 0.7 };
    
    const nodeResult = nodeImportance(activation, sEff);
    const denoResult = denoImportance(activation, sEff);
    
    for (const planet of Object.keys(nodeResult)) {
      expect(denoResult[planet]).toBeCloseTo(nodeResult[planet], 6);
    }
  });
  
  it("effectiveNatalParams produces identical S_eff", () => {
    const natal = { planets: Object.fromEntries(["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"].map(p => [p, { S_initial: 0.5, H_initial: 0.0 }])) };
    const calibration = { S_calibrated: { Sun: 0.7, Moon: 0.4 }, H_calibrated: { Sun: 0.2, Moon: -0.1 } };
    
    const nodeS = nodeEffective(natal, calibration).S_eff;
    const denoS = denoEffective(natal, calibration).S_eff;
    
    for (const planet of Object.keys(nodeS)) {
      expect(denoS[planet]).toBeCloseTo(nodeS[planet], 6);
    }
  });
  
  // Аналогично для всех остальных публичных функций модуля
});
```

Этот тест запускается в обычном `npm test` (импортирует обе версии как чистые TypeScript-модули). Если кто-то поменяет одну версию и забудет другую → CI красный.

## Рекомендую

**Сейчас:** Вариант 2 — добавить parity-тест. 30 минут работы, защищает от дрейфа.

**Через 1-2 спринта:** Вариант 1 — извлечь `daily-engine-core` как чистый shared package. Это правильное долгосрочное решение, но требует аккуратного рефакторинга и тестирования обеих сред.

## Файлы для изменения (Вариант 2)

1. Создать `supabase/functions/_shared/daily-engine-parity.test.ts` (показано выше).
2. Добавить в `vitest.config.ts` (или эквивалент) включение этого файла:
   ```typescript
   test: {
     include: ["**/*.test.ts", "supabase/functions/_shared/*.test.ts"],
   }
   ```

3. Если Deno-версия использует синтаксис, который Vitest не парсит (Deno-specific imports) — нужен мост:
   ```typescript
   // supabase/functions/_shared/daily-engine-bridge.ts
   // Этот файл — обёртка с Node-совместимыми импортами для тестов
   export * from "./dailyForecast.ts";
   ```
   И тест импортирует через bridge.

## Файлы для изменения (Вариант 1, отложенный)

1. Создать `modules/daily-engine-core/` с чистой логикой.
2. Перенести в него: `activation.ts`, `importance.ts`, `types.ts`, `constants.ts`.
3. Переписать `modules/daily-engine/computeDailyForecast.ts` — импорты из `daily-engine-core`.
4. Переписать `supabase/functions/_shared/dailyForecast.ts` — импорты из `daily-engine-core`.
5. Удалить дублирующийся код из обоих мест.
6. Запустить тесты обеих сред.

## Тесты

Помимо parity-теста выше, добавить регрессионный набор «золотых данных»:

```typescript
// modules/daily-engine/golden-fixtures.test.ts

const GOLDEN_FIXTURES = [
  {
    name: "Saturn-day for Tchaikovsky-style chart",
    natal: { /* фикс. данные */ },
    transits: { /* фикс. данные */ },
    calibration: null,
    expected: {
      planetOfTheDay: "Saturn",
      importance_Saturn: 0.847,  // зафиксированное значение
      // и т.д.
    }
  },
  // ...3-5 кейсов
];

describe("Daily-Engine golden fixtures", () => {
  for (const fixture of GOLDEN_FIXTURES) {
    it(`reproduces: ${fixture.name}`, () => {
      const result = computeDailyForecast(fixture.natal, fixture.transits, fixture.calibration);
      expect(result.planetOfTheDay).toBe(fixture.expected.planetOfTheDay);
      expect(result.importance.Saturn).toBeCloseTo(fixture.expected.importance_Saturn, 3);
    });
  }
});
```

Эти фикстуры — **контракт формулы**. Любое изменение коэффициентов (ASPECT_COEF, TRANSIT_WEIGHT, и т.д.) должно сопровождаться явным обновлением фикстур, что заставит автора задуматься «а действительно ли я хочу менять формулу?»

## Как проверить

1. `npm test` — все тесты проходят, включая parity.
2. Намеренно изменить одну версию (например, `ASPECT_COEF.conjunction` на 1.1 в Node-версии) → parity-тест должен упасть.
3. Откатить.

## Критерий приёмки

- ✅ Существует parity-тест, проверяющий идентичность Node и Deno реализаций по всем публичным функциям M2.
- ✅ Добавлены golden-fixtures для 3-5 типовых сценариев.
- ✅ В `MIGRATION_PLAN.md` или `MASTER_README.md` зафиксирована задача на Вариант 1 в backlog с приоритетом «после стабилизации».
- ✅ В `_shared/dailyForecast.ts` появился комментарий-предупреждение:
  ```typescript
  // ⚠️ ВНИМАНИЕ: Эта файл — копия modules/daily-engine/core/activation.ts.
  // Любое изменение формул здесь должно быть зеркально отражено там.
  // Покрыто parity-тестом: supabase/functions/_shared/daily-engine-parity.test.ts
  ```
