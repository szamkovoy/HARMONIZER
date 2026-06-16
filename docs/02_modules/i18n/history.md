---
id: 02_modules/i18n/history
title: i18n History
version: 1.3
updated: 2026-06-16
depends_on: [02_modules/i18n/spec, 04_workspace/i18n_architecture]
code_refs:
  [
    modules/i18n/localeStore.ts,
    modules/i18n/t.ts,
    _legacy_web/app/api/_utils/dialogLocale.ts,
    scripts/i18n-sync.mjs,
  ]
---

## Decision Log

- **2026-06-16:** **Locale plumbing fix (8-language UI).** Root cause of mixed RU/EN/IT:
  `getHomeStrings(appLocale === "en" ? "en" : "ru")` and siblings forced Russian for
  de/fr/it/es/pt/nl; `t.ts` only loaded ru/en catalogs (tabs fell back to English).
  Fixed: pass full `appLocale`, `inlineBaseLocale()` for typed bases, all 8 catalog
  imports, nested chakra overlay flatten, life-sphere titles map, localized
  `UpgradeDialog`, `mathLevelI18nTargets` for server math markdown.

- **2026-06-15 (3):** **Layer C RU-first sync gate.** Dialog scaffold
  (`_legacy_web/data/dialog_scaffold/ru.json`) joins `i18n-sync.mjs` / pre-push
  hook: edit RU → stale keys auto-translate to en + de/fr/it/es/pt/nl.
  `.sync-meta.json` tracks source snapshots; `bootstrap-dialog-scaffold-meta` for
  one-time bootstrap. `dialog-scaffold-fill.mjs` deprecated (delegates to
  `fill --all`).

- **2026-06-15 (2):** **Phase 3 layer C — dialog scaffold for all 8 locales.**
  `_legacy_web/data/dialog_scaffold/{ru,en,de,…}.json` + `getDialogScaffoldStrings()`;
  `resolveDialogScaffoldLocale` returns full content locale (no EN fallback).
  Planning/summary/post-dialog/greeting deterministic strings localized.

- **2026-06-15:** **All 8 locales enabled in Profile; home locale refresh fix.**
  Bulk `node scripts/i18n-sync.mjs fill --all` — JSON catalog + typed overlays for
  de/fr/it/es/pt/nl; `APP_LOCALE_OPTIONS[*].enabled = true`. Server:
  `outputLanguagePrompt.ts` prepends OUTPUT LANGUAGE block to
  `morning_recommendation` monologue; `scenario_cache` rows store `outputLocale`
  and invalidate pre-i18n payloads. Client: `useDayContent` subscribes to locale
  changes, scopes day-cache by locale, strips stale LLM texts, guards secondary
  monologue against race overwrites; `DailyRecommendationCard` shows loading state
  instead of EN fallback template.

- **2026-06-14 (6):** **Locale switch + global-content serve path.** `useDayContent`
  owns locale-change refresh via `subscribeAppLocale` (Home no longer duplicates the
  effect). Free-tier serve: on-demand row `text_i18n` precompute in
  `global-content/route.ts` when cache miss; client SDK fallback restricted to `ru`.
  Gate `fill`: DeepSeek env fallback (`DEEPSEEK_API_KEY`, `AI_MODEL_PREMIUM/STANDARD`).

- **2026-06-14 (5):** **Phase 2 completion — locale persistence, 8-locale layer B,
  typed sync gate, global pre-translate.** (1) `setAppLocale` mirrors to
  `users.locale` via `services/userLocaleClient.ts`. (2) Server split:
  `contentLocales.ts` — `resolveContentLocale` (8 locales, layer B) vs
  `resolveDialogScaffoldLocale` (ru/en, layer C). (3) Free-tier global content:
  migration `text_i18n` on `global_daily_content`; `pretranslateGlobalTexts` +
  cron precompute for en/de/fr/it/es/pt/nl; serve path reads `text_i18n` first.
  (4) Typed-module sync gate: `manifest.json`, overlay JSONs for de–nl,
  `mergeTypedLocale` wired into get*Strings modules; `fill --all` updates catalog +
  typed overlays. (5) `life-spheres/labels.ts` accepts all 8 locale codes (EN
  fallback for non-ru). Spec §3–§8 and dependencies updated.

- **2026-06-14 (4):** **UI sweep + layer B locale plumbing.** Typed modules extended
  (Day, Practices, chakra labels, life-spheres, home math modal, free-tier banner).
  Profile report titles normalized to sentence case; chakra legend labels unified via
  `chakraShortLabelDisplay`. Server: `responseLocale` on `ai/monologue` and
  `ai/global-content`; morning-recommendation cache keyed by locale; EN global texts
  translated on demand (`globalContentLocale.ts`); math markdown RU/EN in
  `mathLevelBuilder` / `buildGlobalMathLevel`. Client: day-content cache scope
  includes locale; Home refreshes LLM content on locale change. Spec §8 updated with
  layer inventory and new-language checklist.

- **2026-06-14 (3):** **Module documented + finite Phase-2 wiring completed.**
  Created this triad (`spec`/`dependencies`/`history`) and registered i18n in
  `MAP.md` (Engines & Services). Added a `.cursor/rules/i18n.mdc` always-on rule so
  i18n is treated as a system invariant in every task. Wiring: Home
  (`index.tsx`), Profile (chrome migrated to the JSON catalog + report cards) and
  the Day/Breath assistant entry points now follow the **shared locale store**
  instead of `profile.locale`/hardcoded `"ru"`, so the Profile language selector
  switches the whole app for RU/EN. Documented the two-tier string strategy (JSON
  catalog for new strings; keep typed `get*Strings` modules) and the precise
  not-yet-migrated tail (startup overlay; dev diagnostics).

- **2026-06-14 (2):** **Phase 2 framework + plumbing (option A).** New client layer
  `modules/i18n/`: `localeStore.ts` (single source of truth, persisted, sync getters
  for services, `APP_LOCALE_OPTIONS` with `enabled` flag, `I18N_TEST_MODE`), `t.ts`
  (`t`/`tCount` with `Intl.PluralRules`; JSON catalogs `catalog/{ru,en}.json`), hooks
  `useAppLocale`/`useTranslate`. Profile gained a language selector. `resolveResponseLocale`
  gained a `requestedLocale` arg; the dialog POST now carries `responseLocale`
  (`getResponseLocale()`), transcription uses `getTranscribeLocale()` (RU in test
  mode). Sync gate `scripts/i18n-sync.mjs` (`check`/`fill`, diff-based, `.sync-meta.json`)
  + pre-push `scripts/i18n-sync.sh`. +6 tests `modules/i18n/t.test.ts`, +2
  `dialogLocale.test.ts`. Rationale & A-vs-B decision: `docs/04_workspace/i18n_architecture.md`.

- **2026-06-14 (1):** **Phase 1 response-locale foundation.** `_utils/dialogLocale.ts`
  (`resolveResponseLocale` + `localeToLanguageName`) split input language (STT) from
  the assistant's reply language; `DIALOG_RESPONSE_LOCALE` env test override (RU in →
  EN out). Threaded through `dialog/route.ts` and `greeting/route.ts`. Zero regression
  when unset. RU/EN only; other languages deferred to Phase 3 (layer-C localization).
