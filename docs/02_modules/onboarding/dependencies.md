---
id: 02_modules/onboarding/dependencies
title: Onboarding Wizard — dependencies
version: 1.0
updated: 2026-07-18
depends_on: [02_modules/onboarding/spec]
---

# Onboarding Wizard — зависимости

## Зависит от

- **`profile`** — авторизация (email-OTP), сессия, `refreshProfile`, запись `users.{birth_date,birth_time,birth_place,lat,lon,tz,location_name,display_name,onboarded_at}`. `AuthProvider.doVerifyEmailCode`/`syncProfile` обновляют имя сразу после шага 1 (независимо от шага 2). Route guard в `app/_layout.tsx` решает пускать в мастер или в `(tabs)`.
- **`astro`** — `BirthData` (`modules/astro-core/core/types.ts`), `createNatalProfile` (`services/natalProfileClient.ts`) → `POST /api/astro/natal`. `birthData.location.timezone` (IANA) — обязательный вход для исторического UTC-преобразования (`astro/spec.md` §3, `localChartDateTime`).
- **`i18n`** — `useTranslate`/`useAppLocale`, каталоги `wizard.*`/`onboarding.birth.*`/`home.geoGate.*` (8 локалей), `i18n-sync`. Native-имя приложения и reason-строки iOS-разрешений — через `app.config.ts` `expo.locales`.
- **`daily_forecast`** — прогрев: `fetchDailyForecast` префетчит дневной прогноз параллельно с экраном `warm`.
- **`infra`** — `expo-location`, `expo-av`/`expo-notifications`, `react-native-maps`, `KeyboardAvoidingView`, `SafeAreaView`, `windowSoftInputMode="adjustResize"` (Android).

## От него зависят

- **`home`** — после `finishOnboarding` пользователь попадает в `(tabs)/index.tsx`; `GeoGate` (этот модуль) используется Home-вкладкой.
- **`profile`** — `NatalBirthDataModal` (`modules/home/ui/NatalBirthDataModal.tsx`) переиспользует `BirthPlacePicker`, `formatGeoPlaceLabel`, `GeoPlace` из `modules/onboarding`.

## Контракты

- **`GeoPlace`** (`modules/onboarding/geoSearchClient.ts`) — `{ id, name, region, country, lat, lng, timezone }`. `timezone` — IANA. Источник: Open-Meteo Geocoding через прокси `GET /api/geo/search` (`_legacy_web/app/api/geo/search`), локаль запроса передаётся параметром `lang`.
- **`BirthData`** (`modules/astro-core/core/types.ts`) — `{ date: "YYYY-MM-DD", timeMode, time?: "HH:MM", location: { lat, lng, timezone } }`. Мастер всегда ставит `timeMode: "precise"`.
- **`createNatalProfile(birthData, signal?, { placeName? })`** (`services/natalProfileClient.ts`) — POST `/api/astro/natal`, кэширует результат локально с fingerprint-ом `birth_*`.
- **`WizardShell` props** — `{ totalSteps, currentStep, children, footer?, statusBarStyle?, contentStyle?, footerInContent? }`.

## Сторонние сервисы

- **Open-Meteo Geocoding** (через Vercel-прокси) — поиск города, координаты, IANA-таймзона, локализованные имена.
- **Supabase Auth** — `signInWithOtp` / `verifyOtp` (email-OTP); RPC `set_signin_name_hint` (таблица `public.signin_name_hints`).
- **Edge `send-auth-email`** — OTP-письмо (8 локалей, локализованное имя/тема/приветствие).
