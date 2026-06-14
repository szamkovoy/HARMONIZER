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

- **2026-06-14 (3):** **Module documented + finite Phase-2 wiring completed.**
  Created this triad (`spec`/`dependencies`/`history`) and registered i18n in
  `MAP.md` (Engines & Services). Added a `.cursor/rules/i18n.mdc` always-on rule so
  i18n is treated as a system invariant in every task. Wiring: Home
  (`index.tsx`), Profile (chrome migrated to the JSON catalog + report cards) and
  the Day/Breath assistant entry points now follow the **shared locale store**
  instead of `profile.locale`/hardcoded `"ru"`, so the Profile language selector
  switches the whole app for RU/EN. Documented the two-tier string strategy (JSON
  catalog for new strings; keep typed `get*Strings` modules) and the precise
  not-yet-migrated tail (`practices/core/catalog.ts` breath titles; startup overlay;
  dev diagnostics).

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
