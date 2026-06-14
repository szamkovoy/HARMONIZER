---
id: 02_modules/i18n/history
title: i18n History
version: 1.0
updated: 2026-06-14
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
