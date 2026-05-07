# PATCH 3 [P0]: Инвалидация кеша user_daily_forecasts по локальному дню пользователя

## Что не так

В `_legacy_web/app/api/calibration/extract/route.ts` после успешной калибровки вызывается удаление кеша:

```typescript
const todayIsoDate = () => new Date().toISOString().slice(0, 10);  // UTC!

await supabase
  .from("user_daily_forecasts")
  .delete()
  .eq("user_id", userId)
  .gte("forecast_date", todayIsoDate());
```

`new Date().toISOString().slice(0, 10)` возвращает **UTC-день**, а не локальный день пользователя. Получается:

- Пользователь в Праге (UTC+1) делает калибровку 28 апреля в 23:30 локального времени → UTC уже 22:30 28 апреля. Всё работает.
- Тот же пользователь делает калибровку 29 апреля в 00:30 локального времени → UTC уже 23:30 28 апреля. **Удаляется только запись за 28-29 апреля и далее, но запись `forecast_date = 2026-04-29` (локальный «сегодня» пользователя) остаётся неудалённой**, если она была посчитана час назад со старой калибровкой.

## Эффект

Краевой случай у полуночи UTC: пользователь видит «сегодняшний» прогноз, посчитанный со старой калибровкой, и удивляется, что калибровка «не сработала». Сложно воспроизвести, легко зафиксировать.

В Москве (UTC+3) этот баг проявляется в окне 21:00–00:00 по UTC = 00:00–03:00 МСК. То есть каждую ночь у полуночи.

## Файлы для изменения

1. `_legacy_web/app/api/calibration/extract/route.ts` — функция `todayIsoDate()`.
2. Любые другие места, где удаляется/выбирается forecast по дате — нужно проверить, что там используется правильная зона.

## Конкретные изменения

### Использовать timezone пользователя

В Supabase `users` таблице есть колонка `tz` (IANA timezone). При калибровке нужно её использовать:

```typescript
import { DateTime } from "luxon";

async function getUserTimezone(supabase, userId: string): Promise<string> {
  const { data } = await supabase
    .from("users")
    .select("tz")
    .eq("id", userId)
    .single();
  return data?.tz ?? "UTC";  // fallback если по какой-то причине нет
}

function todayLocalDate(timezone: string): string {
  // Возвращает YYYY-MM-DD в указанной таймзоне
  return DateTime.now().setZone(timezone).toFormat("yyyy-MM-dd");
}
```

### В обработчике extract

```typescript
const userTz = await getUserTimezone(supabase, userId);
const localToday = todayLocalDate(userTz);

await supabase
  .from("user_daily_forecasts")
  .delete()
  .eq("user_id", userId)
  .gte("forecast_date", localToday);

console.log(`[calibration-extract] Invalidated forecasts for user ${userId} from ${localToday} (tz: ${userTz})`);
```

### Если luxon не установлен — поставить

```bash
cd _legacy_web && npm install luxon
npm install -D @types/luxon
```

Альтернатива без luxon (если хотите минимизировать зависимости):

```typescript
function todayLocalDate(timezone: string): string {
  // Используем Intl API
  const formatter = new Intl.DateTimeFormat("en-CA", {  // en-CA даёт YYYY-MM-DD
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}
```

`Intl.DateTimeFormat` есть в любом Node 18+.

## Дополнительные места для проверки

Поиск по кодовой базе:

```bash
grep -rn "toISOString().slice(0, 10)" _legacy_web/ supabase/functions/ modules/
grep -rn "forecast_date" _legacy_web/ supabase/functions/ modules/
```

Особое внимание:
1. **`supabase/functions/precompute-daily-forecasts/index.ts`** — тут вычисляется forecast_date для будущих дней. Нужно убедиться, что для каждого пользователя дата считается в его локальной зоне.
2. **`_legacy_web/app/api/astro/daily-forecast/route.ts`** — при чтении/создании прогноза.
3. **Главный экран** — какую `forecast_date` запрашивает клиент?

### precompute-daily-forecasts на бэкенде

Логика должна быть такая:

```typescript
// Для каждого активного пользователя
for (const user of users) {
  const userTz = user.tz ?? "UTC";
  
  // Считаем "сегодня" и "завтра" в его таймзоне
  const today = DateTime.now().setZone(userTz).toFormat("yyyy-MM-dd");
  const tomorrow = DateTime.now().setZone(userTz).plus({ days: 1 }).toFormat("yyyy-MM-dd");
  
  // Проверяем, есть ли уже прогнозы на эти даты
  // Если нет — считаем
  // ...
}
```

## Тесты

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { todayLocalDate } from "./calibration-extract-utils";

describe("todayLocalDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    vi.useRealTimers();
  });
  
  it("returns correct date for UTC", () => {
    vi.setSystemTime(new Date("2026-04-29T15:30:00.000Z"));
    expect(todayLocalDate("UTC")).toBe("2026-04-29");
  });
  
  it("returns correct date for Europe/Prague (UTC+1/+2)", () => {
    // 29 апреля 23:30 UTC = 30 апреля 01:30 в Праге (DST=+2 в апреле)
    vi.setSystemTime(new Date("2026-04-29T23:30:00.000Z"));
    expect(todayLocalDate("Europe/Prague")).toBe("2026-04-30");
  });
  
  it("returns correct date for Asia/Tokyo (UTC+9)", () => {
    // 29 апреля 18:00 UTC = 30 апреля 03:00 в Токио
    vi.setSystemTime(new Date("2026-04-29T18:00:00.000Z"));
    expect(todayLocalDate("Asia/Tokyo")).toBe("2026-04-30");
  });
  
  it("returns correct date for America/Los_Angeles when UTC just passed midnight", () => {
    // 29 апреля 02:00 UTC = 28 апреля 19:00 в LA (UTC-7 в апреле DST)
    vi.setSystemTime(new Date("2026-04-29T02:00:00.000Z"));
    expect(todayLocalDate("America/Los_Angeles")).toBe("2026-04-28");
  });
});
```

## Как проверить

1. Поставить mock время в момент `2026-04-29T23:30:00Z` (~01:30 МСК следующего дня для МСК-пользователя).
2. Создать пользователя с `tz = "Europe/Moscow"`.
3. Создать `user_daily_forecasts` записи для дат `2026-04-29` и `2026-04-30`.
4. Запустить calibration extract.
5. Убедиться, что **обе** записи удалены (а не только `2026-04-30+`).

## Критерий приёмки

- ✅ `todayLocalDate(tz)` возвращает корректную дату для разных таймзон.
- ✅ `/api/calibration/extract` использует timezone из `users.tz`.
- ✅ Тестовый сценарий «полночь UTC» правильно инвалидирует кеш.
- ✅ Все остальные места работы с `forecast_date` используют локальную зону (или явно UTC, если это правильно для их случая).
