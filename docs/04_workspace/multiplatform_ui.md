---
id: 04_workspace/multiplatform_ui
title: Multiplatform UI Strategy (iOS + Android)
version: 1.0
updated: 2026-07-22
depends_on: [01_foundation/architecture]
code_refs:
  [
    modules/ui/theme.ts,
    modules/ui/themePreference.ts,
    modules/ui/AppText.tsx,
    modules/ui/AppButton.tsx,
    modules/ui/TabScreenLayout.tsx,
    modules/bootstrap/AppStartupProvider.tsx,
    app/_layout.tsx,
    plugins/with-native-health.js,
  ]
---

# Multiplatform UI Strategy (iOS · Android · vendors)

HARMONIZER — одно Expo/React Native приложение. Целевые поверхности: **iPhone (отлаженный эталон)** и **Android** (Samsung, Pixel, Huawei и др.). Любая UI-задача рассматривается через призму мультиплатформенности: не ломать iOS, не чинить только один вендор Android.

## Принципы (что берём из отраслевой практики)

| Подход | Как используем у нас |
| --- | --- |
| **Единый design system / semantic tokens** | Канон: `modules/ui/theme.ts` (`buildTheme("light" \| "dark")`), `AppText` / `AppButton` / `SURFACE_CARD` / `TabScreenLayout`. Цвета и типографика — по роли (`textPrimary`, `surfaceElevated`), не hex в экранах. |
| **Один источник темы, не system Material/UIKit** | Палитра — **явный выбор пользователя** (`themePreference`, default **light**). Не следуем автоматически `useColorScheme()` для бренд-UI (иначе Android dark system + light card → «бледный» текст). System colors / Expo Router `Color.android.dynamic.*` — только если сознательно нужен нативный look; для продукта — наши токены. |
| **Safe areas / keyboard / insets** | `react-native-safe-area-context` + проверенные оболочки (`TabScreenLayout`, onboarding `WizardShell`). Android IME: `KeyboardAvoidingView` / `android:windowSoftInputMode` — править в общем layout, не на одном экране «магическим» margin. |
| **Platform deltas тонким слоем** | `Platform.OS` / `Platform.select` — только где поведение реально расходится (Health Connect vs HealthKit, splash flash, permission APIs). Не копировать целые экраны под Android. |
| **Нативные модули с degrade** | Плагин config (`plugins/with-native-health.js`) + JS try/catch → `unavailable`, без native crash. После правки plugin — **rebuild** dev-client. |
| **Эталон + регрессия** | Визуальный эталон — iPhone. Android QA на Pixel (и при возможности Samsung). Правка «только под Android» допустима, если не меняет iOS-путь или покрыта `Platform.select`. |

## Правила для агентов и разработчиков

1. **Перед UI-правкой:** прочитать этот файл + токены в `modules/ui/theme.ts`. Не хардкодить `#FFFFFF` / белый текст на оверлеях — брать `theme.colors.*` или явно `buildTheme("light")` для forced-light зон (онбординг).
2. **Оверлеи и модалки** живут внутри `ThemeProvider` и читают `useTheme()` (пример: `DayWaitCardOverlay` в `AppStartupProvider`).
3. **Палитра:** переключатель в Профиле (`app/(tabs)/profile.tsx`); persist — `modules/ui/themePreference.ts`. Default на чистой установке — **light**.
4. **Prefetch / фоновые эффекты:** cleanup `useEffect` не должен отбрасывать уже успешный результат (Strict Mode / churn зависимостей на Android чаще «сжигает» prefetch). См. Home → Day в `daily_forecast`.
5. **Не чинить только один телефон:** если баг в shared theme/layout — чинить shared; если только OEM quirk — `Platform` + комментарий «почему Android».
6. **Документация:** продуктовые контракты модулей — в триадах; **эта стратегия** — здесь (`04_workspace`), не размазывать по `spec.md`. В `history.md` модуля — короткая отсылка при UI/platform-фиксе.

## Связанные места в коде

- Тема: `modules/ui/theme.ts`, `themePreference.ts`, `app/_layout.tsx` (`UiThemeProvider` + Nav theme).
- Forced light (мастер): `modules/onboarding/wizard/WizardShell.tsx`.
- Day wait card: `modules/bootstrap/AppStartupProvider.tsx`.
- Android Health Connect delegate: `plugins/with-native-health.js` + guard в `services/nativeHealth.ts`.
