# PATCH 1 [P0]: Исправление пропорций усреднения в M3 (60/40 manual, 50/50 auto)

## Что не так

Согласно `MODULE_3_Calibration_TZ.md` раздел «Этап D: Усреднение»:
- Для `source = "initial"` или `"manual_resync"` — пропорция **60% натальное / 40% обратная связь**.
- Для `source = "auto_aggregated"` — пропорция **50/50** (данных больше, доверяем им сильнее).

В реализации `_legacy_web/app/api/_utils/calibration.ts` функция `averageCalibration()` всегда применяет `(sInitial + sProposed) / 2`, что эквивалентно 50/50 во всех случаях. Параметр `source` не передаётся.

## Эффект на пользователей

При ручной калибровке влияние слов пользователя сейчас **в 1.5 раза сильнее**, чем заложено в ТЗ. Это снижает «защиту от приукрашивания», особенно у пользователей с сильными контрастами восприятия себя vs натальной картой.

## Файлы для изменения

1. `_legacy_web/app/api/_utils/calibration.ts` — функция `averageCalibration()`
2. `_legacy_web/app/api/calibration/extract/route.ts` — вызов `averageCalibration()` с проброской `source`
3. Места вызова из Edge Functions, если есть (`supabase/functions/auto-calibrate/`).

## Конкретные изменения

### 1. Сигнатура и логика `averageCalibration()`

**Текущая (50/50):**
```typescript
export function averageCalibration(natalProfile, extraction): { ... } {
  // ...
  for (const planet of PLANETS_7) {
    // ...
    const sCal = (sInitial + sProposed) / 2;
    const hCal = (hInitial + hProposed) / 2;
    // ...
  }
}
```

**Должна быть:**
```typescript
type CalibrationSource = "initial" | "manual_resync" | "auto_aggregated";

const AVERAGING_WEIGHTS: Record<CalibrationSource, { wNatal: number; wProposed: number }> = {
  initial:         { wNatal: 0.6, wProposed: 0.4 },
  manual_resync:   { wNatal: 0.6, wProposed: 0.4 },
  auto_aggregated: { wNatal: 0.5, wProposed: 0.5 },
};

export function averageCalibration(
  natalProfile: NatalProfile,
  extraction: ExtractionOutput,
  source: CalibrationSource,  // НОВЫЙ обязательный параметр
): {
  S_calibrated: Record<Planet, number>;
  H_calibrated: Record<Planet, number>;
  delta_from_initial: Record<Planet, { dS: number; dH: number }>;
} {
  const { wNatal, wProposed } = AVERAGING_WEIGHTS[source];
  
  const sCalibrated = {} as Record<Planet, number>;
  const hCalibrated = {} as Record<Planet, number>;
  const deltaFromInitial = {} as Record<Planet, { dS: number; dH: number }>;
  
  for (const planet of PLANETS_7) {
    const sInitial = natalProfile.planets[planet].S_initial;
    const hInitial = natalProfile.planets[planet].H_initial;
    
    // Дельты от LLM клампуем на ±0.30
    const dS = clamp(extraction.deltas[planet].dS, -0.30, 0.30);
    const dH = clamp(extraction.deltas[planet].dH, -0.30, 0.30);
    
    // Гипотетическое значение по словам пользователя (тоже кламп)
    const sProposed = clamp(sInitial + dS, 0, 1);
    const hProposed = clamp(hInitial + dH, -1, 1);
    
    // Взвешенное усреднение по source
    const sCal = clamp(wNatal * sInitial + wProposed * sProposed, 0, 1);
    const hCal = clamp(wNatal * hInitial + wProposed * hProposed, -1, 1);
    
    sCalibrated[planet] = sCal;
    hCalibrated[planet] = hCal;
    deltaFromInitial[planet] = {
      dS: sCal - sInitial,
      dH: hCal - hInitial,
    };
  }
  
  return { S_calibrated: sCalibrated, H_calibrated: hCalibrated, delta_from_initial: deltaFromInitial };
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}
```

### 2. Обновить вызов в `/api/calibration/extract/route.ts`

Найти место вызова `averageCalibration(...)` и пробросить `source` из тела запроса:

```typescript
const { source } = body; // "initial" | "manual_resync" | "auto_aggregated"

// Валидация source — должен быть одним из трёх
if (!["initial", "manual_resync", "auto_aggregated"].includes(source)) {
  return NextResponse.json(
    { error: "Invalid source. Must be initial, manual_resync, or auto_aggregated" },
    { status: 400 }
  );
}

const calibrationResult = averageCalibration(natalProfile, extraction, source);
```

### 3. Обновить вызовы в Edge Functions (если они напрямую используют `averageCalibration`)

В `supabase/functions/auto-calibrate/index.ts` — при создании финальной калибровки передавать `source: "auto_aggregated"`.

⚠️ **Важно:** Если auto-calibrate использует свою копию функции (как для `dailyForecast.ts` — см. PATCH 7), нужно синхронизировать обе.

## Тесты

Создать или дополнить `_legacy_web/app/api/_utils/calibration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { averageCalibration } from "./calibration";

const mockNatal = {
  planets: {
    Sun:     { S_initial: 0.50, H_initial: 0.00 },
    Moon:    { S_initial: 0.50, H_initial: 0.00 },
    Mercury: { S_initial: 0.50, H_initial: 0.00 },
    Venus:   { S_initial: 0.50, H_initial: 0.00 },
    Mars:    { S_initial: 0.50, H_initial: 0.00 },
    Jupiter: { S_initial: 0.50, H_initial: 0.00 },
    Saturn:  { S_initial: 0.50, H_initial: 0.00 },
  }
};

const mockExtractionMaxPositive = {
  deltas: {
    Sun:     { dS: 0.30, dH: 0.30, confirmed: true },
    Moon:    { dS: 0.30, dH: 0.30, confirmed: true },
    Mercury: { dS: 0.30, dH: 0.30, confirmed: true },
    Venus:   { dS: 0.30, dH: 0.30, confirmed: true },
    Mars:    { dS: 0.30, dH: 0.30, confirmed: true },
    Jupiter: { dS: 0.30, dH: 0.30, confirmed: true },
    Saturn:  { dS: 0.30, dH: 0.30, confirmed: true },
  }
};

describe("averageCalibration", () => {
  it("uses 60/40 ratio for source=initial", () => {
    const result = averageCalibration(mockNatal, mockExtractionMaxPositive, "initial");
    
    // S: 0.6 * 0.50 + 0.4 * 0.80 = 0.62
    expect(result.S_calibrated.Sun).toBeCloseTo(0.62, 2);
    // H: 0.6 * 0.00 + 0.4 * 0.30 = 0.12
    expect(result.H_calibrated.Sun).toBeCloseTo(0.12, 2);
  });
  
  it("uses 60/40 ratio for source=manual_resync", () => {
    const result = averageCalibration(mockNatal, mockExtractionMaxPositive, "manual_resync");
    expect(result.S_calibrated.Sun).toBeCloseTo(0.62, 2);
  });
  
  it("uses 50/50 ratio for source=auto_aggregated", () => {
    const result = averageCalibration(mockNatal, mockExtractionMaxPositive, "auto_aggregated");
    
    // S: 0.5 * 0.50 + 0.5 * 0.80 = 0.65
    expect(result.S_calibrated.Sun).toBeCloseTo(0.65, 2);
    // H: 0.5 * 0.00 + 0.5 * 0.30 = 0.15
    expect(result.H_calibrated.Sun).toBeCloseTo(0.15, 2);
  });
  
  it("clamps deltas to ±0.30 even if LLM returns out-of-range", () => {
    const extremeExtraction = {
      deltas: {
        ...mockExtractionMaxPositive.deltas,
        Sun: { dS: 0.50, dH: -0.80, confirmed: true }  // вне диапазона
      }
    };
    const result = averageCalibration(mockNatal, extremeExtraction, "initial");
    
    // Должен использовать кламп 0.30 → S_proposed = 0.80
    expect(result.S_calibrated.Sun).toBeCloseTo(0.62, 2);
    // Кламп -0.30 → H_proposed = -0.30, итог: 0.6*0 + 0.4*(-0.3) = -0.12
    expect(result.H_calibrated.Sun).toBeCloseTo(-0.12, 2);
  });
  
  it("clamps result to valid ranges [0,1] and [-1,1]", () => {
    const highNatal = {
      planets: Object.fromEntries(
        ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"]
          .map(p => [p, { S_initial: 0.95, H_initial: 0.95 }])
      )
    };
    const result = averageCalibration(highNatal, mockExtractionMaxPositive, "auto_aggregated");
    
    // S_proposed бы был 1.25 → clamped to 1.0
    expect(result.S_calibrated.Sun).toBeLessThanOrEqual(1.0);
    expect(result.H_calibrated.Sun).toBeLessThanOrEqual(1.0);
  });
});
```

## Миграция существующих данных

Если в БД уже есть пользовательские калибровки, посчитанные с 50/50:
- **Не делать массовую миграцию** — это сместит профили пользователей, которые уже привыкли к работе системы.
- **При следующей ручной калибровке** пользователь автоматически получит правильную пропорцию 60/40.
- **Auto-calibrations через 7 дней** также пересчитают калибровку.

То есть пользователи «доедут» до правильной формулы естественным путём в течение ~10-14 дней.

Если хотите принудительно — можно сделать одноразовый SQL-скрипт, но я **не рекомендую**:
```sql
-- НЕ ВЫПОЛНЯТЬ без особой нужды
-- Это пересчитает калибровки, но потребует валидных raw_feedback и LLM-вызова на каждого
```

## Как проверить

1. `npm test` — все тесты должны проходить, включая новые.
2. Сделать тестовую калибровку с `source: "manual_resync"` → проверить, что в `user_calibrations.delta_from_initial` дельты примерно в 1.33× меньше, чем были раньше.
3. В debug-инспекторе тестового стенда (если он есть) — увидеть `averagingProportion: { wNatal: 0.6, wProposed: 0.4 }`.

## Критерий приёмки

- ✅ `averageCalibration(natal, extraction, "initial")` использует 60/40.
- ✅ `averageCalibration(natal, extraction, "auto_aggregated")` использует 50/50.
- ✅ Все три ветки покрыты unit-тестами.
- ✅ `npx tsc --noEmit` — без ошибок типов.
- ✅ `/api/calibration/extract` валидирует `source` и возвращает 400 при невалидном.
