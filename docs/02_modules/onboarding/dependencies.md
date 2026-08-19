---
id: 02_modules/onboarding/dependencies
title: Onboarding Wizard — dependencies
version: 1.2
updated: 2026-08-20
depends_on: [02_modules/onboarding/spec]
---

# Onboarding Wizard — зависимости

## Зависит от

- **`profile`** — авторизация (email-OTP), сессия, `refreshProfile`, запись `users.{birth_date,birth_time,birth_place,lat,lon,tz,location_name,display_name,onboarded_at}`; GPS после granted — фон `acquireAndPersistUserCoordinates` → `scheduleGeoPlaceSyncAfterCoords` → `country_code`/`city`. `AuthProvider.doVerifyEmailCode`/`syncProfile` обновляют имя сразу после шага 1 (независимо от шага 2). Route guard в `app/_layout.tsx` решает пускать в мастер или в `(tabs)`.
- **`astro`** — `BirthData` (`modules/astro-core/core/types.ts`), `createNatalProfile` (`services/natalProfileClient.ts`) → `POST /api/astro/natal`. `birthData.location.timezone` (IANA) — обязательный вход для исторического UTC-преобразования (`astro/spec.md` §3, `localChartDateTime`).
- **`i18n`** — `useTranslate`/`useAppLocale`, каталоги `wizard.*`/`onboarding.birth.*`/`home.opportunityWindows.needLocation` (8 локалей), `i18n-sync`. Native-имя приложения и reason-строки iOS-разрешений — через `app.config.ts` `expo.locales`.
- **`daily_forecast`** — прогрев сразу после натала на шаге 2 (не ждёт GPS): `fetchDailyForecast({ forceRefresh: true, timeoutMs: 90_000 })` + `saveDayContentCache` (те же access/scope ключи, что Home). Экран `warm` — только если тексты ещё не готовы к концу шага 7.
- **`access`** — `getEffectiveAccess` / `accessModeForTier` для ключей кэша дня (trial → tier `master`, mode `premium`).
- **`infra`** — `expo-location`, `expo-av`/`expo-notifications`, `react-native-maps`, `KeyboardAvoidingView` (iOS), Android IME-height padding в `WizardShell`, `SafeAreaView`, `windowSoftInputMode="adjustResize"` + `expo-splash-screen` (белый фон и в dark).
- **`modules/ui/theme`** — светлая палитра мастера (`buildTheme("light")` / `ThemeProvider` в `WizardShell`); поля — `WizardTextInput`.

## От него зависят

- **`home`** — после `finishOnboarding` пользователь попадает в `(tabs)/index.tsx`; CTA геолокации живёт в `OpportunityWindows`, не отдельным гейтом.
- **`profile`** — `NatalBirthDataModal` (`modules/home/ui/NatalBirthDataModal.tsx`) переиспользует `BirthPlacePicker`, `formatGeoPlaceLabel`, `GeoPlace` из `modules/onboarding`, общие хелперы маски/валидации даты-времени рождения из `modules/onboarding/birthDateFormat.ts` (`formatDateMask`/`formatTimeMask`/`ddmmyyyyToIso`/`isoToDdmmyyyy`), а также **`MaskedTextInput`** (`modules/onboarding/MaskedTextInput.tsx`) — сегментный ввод даты/времени (каждый сегмент DD/MM/YYYY/HH — отдельный `TextInput` с `selectTextOnFocus`, сегменты изолированы — правка одного не сдвигает другой); `BirthPlaceMapModal` используется в блоке «Мои данные» Профиля для сверки сохранённого места рождения; внизу вкладки Профиль — **`LegalFooter tone="links"`** (те же юр. документы / модалка, что на шаге 1 мастера).

## Контракты

- **`GeoPlace`** (`modules/onboarding/geoSearchClient.ts`) — `{ id, name, region, country, lat, lng, timezone }`. `timezone` — IANA. Источник: Open-Meteo Geocoding через прокси `GET /api/geo/search` (`_legacy_web/app/api/geo/search`), локаль запроса передаётся параметром `lang`.
- **`BirthData`** (`modules/astro-core/core/types.ts`) — `{ date: "YYYY-MM-DD", timeMode, time?: "HH:MM", location: { lat, lng, timezone } }`. Мастер всегда ставит `timeMode: "precise"`.
- **`createNatalProfile(birthData, signal?, { placeName? })`** (`services/natalProfileClient.ts`) — POST `/api/astro/natal`, кэширует результат локально с fingerprint-ом `birth_*`.
- **`WizardShell` props** — `{ totalSteps, currentStep, children, footer?, statusBarStyle?, contentStyle?, footerInContent?, contentBumpKey? }`. При `footerInContent` CTA+legal внутри скролла (шаги 1–2); подъём — `KeyboardAvoidingView behavior="padding"` (iOS) / IME `paddingBottom` (Android) + `scrollToEnd`; `contentBumpKey` — доп. нюдж при росте контента (место рождения).

## Сторонние сервисы

- **Open-Meteo Geocoding** (через Vercel-прокси) — поиск города рождения, координаты, IANA-таймзона, локализованные имена.
- **Nominatim/OSM** (через `GET /api/geo/reverse`) — ближайший город для `users.city` / `country_code` (профиль/админ); ≤1 req/s, кэш, порог 100 км.
- **Supabase Auth** — `signInWithOtp` / `verifyOtp` (email-OTP); RPC `set_signin_name_hint`; OTP ledgers/permits (`otp_send_events`, `otp_send_permits`, `otp_verify_failures`, migration `20260730180000`).
- **Vercel `POST /api/auth/otp-gate`** — App Check verify + `otp_issue_send_permit` before send.
- **Vercel `POST /api/auth/otp-verify`** — store-review allowlist (`STORE_REVIEW_EMAIL` / `STORE_REVIEW_OTP`) → mint session; иначе клиент → GoTrue `verifyOtp`.
- **Edge `send-auth-email`** — OTP-письмо; `otp_consume_send_permit` (rate limits + optional permit when `OTP_REQUIRE_APP_CHECK=true`); для `STORE_REVIEW_EMAIL` — skip send.
- **Firebase App Check** — Play Integrity / App Attest (`@react-native-firebase/app-check`); Expo/Test — debug provider или `EXPO_PUBLIC_OTP_APP_CHECK_DEBUG_SECRET`.
