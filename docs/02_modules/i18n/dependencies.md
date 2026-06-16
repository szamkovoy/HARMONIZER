---
id: 02_modules/i18n/dependencies
title: i18n Dependencies
version: 1.3
updated: 2026-06-16
depends_on: [02_modules/i18n/spec]
code_refs:
  [
    modules/i18n/localeStore.ts,
    modules/i18n/t.ts,
    app/_layout.tsx,
    app/(tabs)/_layout.tsx,
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
| `app/_layout.tsx` (bootstrap) | `hydrateAppLocale(profile?.locale)` | Called once in `AccessBridge`; seeds the store at startup. |
| `app/(tabs)/_layout.tsx` (subscription/nav) | `useTranslate().t("tabs.*")`, `key={locale}` on `<Tabs>` | Tab labels via catalog; remount on locale change. |
| `subscription` (`modules/access/ui/UpgradeDialog.tsx`) | `useTranslate()` — `tier.*`, `upgrade.*` | Tier/feature labels and body text via JSON catalog (not `TIER_LABELS`). |
| `life-spheres` (`modules/life-spheres/labels.ts`) | `AppContentLocale`, `asContentLocale` | Client sphere titles for all 8 locales (`SPHERE_TITLES`). |
| `profile` (`app/(tabs)/profile.tsx`) | `useAppLocale`, `useTranslate`, `APP_LOCALE_OPTIONS`, `setLocale` | Hosts the **language selector**; passes the shared locale into `getProfileReportStrings` and report cards. |
| `home` (`app/(tabs)/index.tsx`) | `useAppLocale().locale` → `getHomeStrings` | Home strings + the `<Communicator locale=...>` prop follow the store. |
| `daily_forecast` (`modules/home/useDayContent.ts`) | `getResponseLocale()`, **`subscribeAppLocale`** | Day cache scope and LLM refresh on locale change; strips locale-specific forecast texts before reload. |
| `daily_forecast` (`app/(tabs)/day.tsx`) | `useAppLocale().locale` → `<Communicator locale=...>` | Day assistant locale follows the store. |
| `practices`/`breath` (`app/breath-coherence.tsx`) | `useAppLocale().locale` → `<CoherenceBreathScreen locale=...>` | Breath screen locale follows the store. |
| `communicator` (`Communicator.tsx`) | `getTranscribeLocale()` | STT language; `ru` in test mode. The displayed UI strings still come from the `locale` prop passed by the host screen. |
| `services/communicator-client.ts` | `getResponseLocale()` | `buildDialogPostBody` adds `responseLocale` to every dialog POST (default = active locale). |
| `services/userLocaleClient.ts` | `syncUserLocaleToServer` | Called from `setAppLocale`; mirrors active locale to Supabase `users.locale`. |

## Inbound — what i18n depends on
- **`assistant` (server)** consumes `responseLocale` via
  `resolveContentLocale` / `resolveDialogScaffoldLocale` in `dialog/route.ts` and
  `greeting/route.ts`. Contract: the **request body MAY carry `responseLocale`**;
  precedence is env override → body → `users.locale` → `ru`. Layer B uses all 8
  locales; layer C scaffolding uses `_legacy_web/data/dialog_scaffold/*.json` (all 8,
  RU-first sync via `i18n-sync.mjs`).
- **`profile` / Supabase** — `users.locale` (default `ru`) is read server-side and
  **written back** when the in-app selector changes (`setAppLocale` →
  `syncUserLocaleToServer`). Client also seeds the store from it at hydrate.
- **`lifeSpheresBaseline`** (`_legacy_web/.../lifeSpheresBaseline.ts`,
  `data/life_spheres_baseline/{ru,en}.json`) — selected by the resolved response
  locale. The only data file that is locale-aware today (layer A otherwise RU).

## External libraries / infra
- **`Intl.PluralRules`** — plural categories per locale (`t.ts`). Language-complete.
- **Luxon** — locale-aware date/number formatting (use the active locale; do not
  hand-format dates).
- **expo-secure-store** / web `localStorage` — locale persistence.
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
