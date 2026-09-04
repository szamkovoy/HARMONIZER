---
id: 02_modules/i18n/dependencies
title: i18n Dependencies
version: 1.16
updated: 2026-09-05
depends_on: [02_modules/i18n/spec]
code_refs:
  [
    modules/i18n/localeStore.ts,
    modules/i18n/t.ts,
    app/_layout.tsx,
    app/(tabs)/_layout.tsx,
    app.config.ts,
    plugins/appLocalesData.js,
    modules/access/ui/UpgradeDialog.tsx,
    modules/life-spheres/labels.ts,
    app/(tabs)/index.tsx,
    app/(tabs)/profile.tsx,
    app/(tabs)/day.tsx,
    app/breath-coherence.tsx,
    services/communicator-client.ts,
    modules/communicator/ui/Communicator.tsx,
    _legacy_web/app/api/_utils/dialogLocale.ts,
    _legacy_web/app/api/communicator/v2/dialog/route.ts,
    _legacy_web/app/api/communicator/v2/greeting/route.ts,
    _legacy_web/app/api/_utils/dialogScaffold/index.ts,
    _legacy_web/data/dialog_scaffold/ru.json,
    scripts/i18n-sync.mjs,
  ]
---

# i18n — dependencies & contracts

i18n is cross-cutting: it has no single "owner" screen but is consumed everywhere.
This file lists the contracts so a change here is traceable to its blast radius.

## Internal (within `modules/i18n`)
- `useAppLocale` / `useTranslate` → read `localeStore` via `useSyncExternalStore`.
- `t` / `tCount` → import the JSON catalogs and `AppLocale` (type-only) from
  `localeStore` (no React/RN runtime dependency, so they are unit-testable in Node).
- `index.ts` is the only import surface (`@/modules/i18n`).

## Outbound — what i18n provides to other modules
| Consumer (module) | Uses | Contract |
|-------------------|------|----------|
| `app/_layout.tsx` (bootstrap) | `hydrateAppLocale(profile?.locale)` | Called in `AccessBridge` when `profile?.locale` changes; `users.locale` wins over sticky SecureStore from a previous account. Cold-start hydrate also runs from **`AuthProvider.syncProfile`** before `profileLoading` clears. |
| `profile` (`AuthProvider`) | `hydrateAppLocale` | Locale store ready before Home `useDayContent` refresh. |
| `bootstrap` (`AppStartupProvider`) | `useAppLocale()`, `t(locale, "startup.step.*")`, `t(locale, "startup.fallback")` | Splash footer copy follows the shared locale store; internal step ids map to catalog keys (`AUTH/foo` → `startup.step.AUTH_foo`). |
| `practices` (`catalog.ts`, `PracticeCard`) | `useAppLocale()`, `getPracticeCatalogStrings`, `asContentLocale` / `inlineBaseLocale` / `SOURCE_LOCALE` | Catalog UI strings + yoga jsonb title lookup for all 8 content locales. |
| `app/(tabs)/_layout.tsx` (subscription/nav) | `useTranslate().t("tabs.*")` | Tab labels via catalog; labels refresh on locale change without remounting `<Tabs>` (scroll/state preserved). |
| `subscription` (`modules/access/ui/UpgradeDialog.tsx`) | `useTranslate()` — `tier.*`, `upgrade.*` | Tier/feature labels and body text via JSON catalog (not `TIER_LABELS`). |
| `life-spheres` (`modules/life-spheres/labels.ts`) | `AppContentLocale`, `asContentLocale` | Client sphere titles for all 8 locales (`SPHERE_TITLES`). |
| `profile` (`app/(tabs)/profile.tsx`) | `useAppLocale`, `useTranslate`, `APP_LOCALE_OPTIONS`, `setLocale` | Hosts the **language selector** (probe day texts → instant `setLocale` or confirm/ensure dialog with `profile.language.rebuild*`); passes the shared locale into `getProfileReportStrings` and report cards; bottom **`LegalFooter`** reads `wizard.legal.*` in the active locale. |
| `home` (`app/(tabs)/index.tsx`, `ChakraFlower`, `OpportunityWindows`) | `useAppLocale().locale` → `getHomeStrings` | Home strings + `<Communicator locale=...>`; typed overlays include **`planetLabels`**, **`chakraFlower.captionFree`/`captionPersonal`**, and **`opportunityWindows`** templates (`paidIntroTemplate`, detail/help templates) rebound after merge so non-RU locales do not keep EN function bodies. |
| `daily_forecast` (`modules/home/useDayContent.ts`, `localeDayContentProbe` / `Ensure`) | `getResponseLocale()`, **`subscribeAppLocale`**, day-content locale readiness | Day cache scope and LLM refresh on locale change; profile probes/ensures free `global_daily_content.text_i18n` / paid `scenario_cache` before committing a language with missing day texts. |
| `daily_forecast` (`app/(tabs)/day.tsx`) | `useAppLocale().locale` → `<Communicator locale=...>` | Day assistant locale follows the store. |
| `practices`/`breath` (`app/breath-coherence.tsx`) | `useAppLocale().locale` → `<CoherenceBreathScreen locale=...>` | Breath screen locale follows the store. |
| `charts` (`DonutChart`) | `getChartStrings(locale)` via `mergeTypedLocale("charts", …)` | `DonutChart`: center `balanceLabel`. RU/EN inline in `modules/charts/i18n/charts.ts`, de/fr/it/es/pt/nl in `typed/catalog/charts/*.json`. |
| `communicator` (`Communicator.tsx`) | `useAppLocale()`, `getTranscribeLocale()` | Default STT via `getTranscribeLocale()` (active locale). Each dialog POST sends **`responseLocale`** + **`inputLocale`**; with `EXPO_PUBLIC_I18N_TEST_MODE` voice turns may auto-detect speech and temporarily route the reply there, while outside test mode the reply stays on the selected/profile locale. UI strings still come from the host `locale` prop. |
| `services/communicator-client.ts` | `getResponseLocale()`, `getTranscribeLocale()` | `buildDialogPostBody` adds `responseLocale` and `inputLocale` to every dialog POST (defaults = active locale for both); voice flow may still override per turn when test mode intentionally enables speech-driven replies. |
| `services/userLocaleClient.ts` | `syncUserLocaleToServer` | Called from `setAppLocale` / hydrate write-back; mirrors active locale to Supabase `users.locale` via **`getSupabaseAccessSession`**. |

## Inbound — what i18n depends on
- **`assistant` (server)** consumes `responseLocale` via
  `resolveContentLocale` / `resolveDialogScaffoldLocale` in `dialog/route.ts` and
  `greeting/route.ts`, and optional **`inputLocale`** in `dialog/route.ts` only
  (for `inputLanguageName` / `inputLanguageDecouplingInstruction` in
  `dialogBranchPrompts.ts`). Layer-C visible builders also include
  `practiceCardSummary.ts`, localized `/api/day` copy (`getDayStrings`,
  `getLifeSphereTitle`, `getCoherenceBreathStrings`), and `practiceSelection.ts`
  practice titles. Contract: the **request body MAY carry `responseLocale`**
  and **`inputLocale`**; precedence is env override → body → `users.locale` → `ru`. Layer B uses all 8
  locales; layer C scaffolding uses `_legacy_web/data/dialog_scaffold/*.json` (all 8,
  RU-first sync via `i18n-sync.mjs`).
- **`profile` / Supabase** — `users.locale` (default `ru`) is read server-side and
  **written back** when the in-app selector changes (`setAppLocale` →
  `syncUserLocaleToServer`). Client also seeds the store from it at hydrate.
- **`lifeSpheresBaseline`** (`_legacy_web/.../lifeSpheresBaseline.ts`,
  `data/life_spheres_baseline/{ru,en}.json`) — selected by the resolved response
  locale. The only data file that is locale-aware today (layer A otherwise RU).

## External libraries / infra
- **`expo-localization`** — `getLocales()` reads the OS ordered preferred-languages
  list for first-launch device-locale detection in `localeStore.deviceLocale()`
  (replaces the single-locale `Intl` probe). No native rebuild needed (works in
  Expo Go / dev client).
- **`Intl.PluralRules`** — plural categories per locale (`t.ts`). Language-complete.
- **Luxon** — locale-aware date/number formatting (use the active locale; do not
  hand-format dates).
- **expo-secure-store** / web `localStorage` — locale persistence.
- **Native app name & iOS permission reasons** (build-time, not a runtime module
  dependency): `app.config.ts` `expo.locales` (built from `plugins/appLocalesData.js`)
  → iOS `<lang>.lproj/InfoPlist.strings` (`CFBundleDisplayName` +
  `NSXxxUsageDescription`) and Android `res/values-<lang>/strings.xml` (`app_name`),
  applied via `npx expo prebuild`. The localized brand map is the single source for
  the name under the icon, in system dialogs, and in the OTP email.
- **Vercel env** — `DIALOG_RESPONSE_LOCALE` (server test override).
  **Expo env** — `EXPO_PUBLIC_I18N_TEST_MODE` (client test mode).
- **Translate API** (gate `fill`) — `I18N_TRANSLATE_API_URL / _API_KEY / _MODEL`, or
  fallback **`DEEPSEEK_API_KEY`** + **`AI_MODEL_PREMIUM` / `AI_MODEL_STANDARD`**. Covers
  UI catalog, typed overlays, and `dialog_scaffold/` JSON.

## Contract-risk checklist (touch i18n if a task does any of these)
- Adds/edits any user-facing string, alert, button, placeholder, or screen.
- Changes the assistant's reply language or `languageName` derivation.
- Adds a deterministic visible-text builder / fallback on the server (layer C).
- Adds a date/number/plural rendering.
- Adds a new response language (see spec §6).
- Adds a new module with UI → it must consume `@/modules/i18n`, not hardcode RU.
