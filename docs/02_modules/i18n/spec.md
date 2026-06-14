---
id: 02_modules/i18n/spec
title: i18n (Multilingual) Spec
version: 1.0
updated: 2026-06-14
depends_on: [01_foundation/architecture, 02_modules/assistant/spec, 02_modules/communicator/spec, 04_workspace/i18n_architecture]
code_refs:
  [
    modules/i18n/localeStore.ts,
    modules/i18n/t.ts,
    modules/i18n/useAppLocale.ts,
    modules/i18n/useTranslate.ts,
    modules/i18n/index.ts,
    modules/i18n/catalog/ru.json,
    modules/i18n/catalog/en.json,
    _legacy_web/app/api/_utils/dialogLocale.ts,
    _legacy_web/app/api/communicator/v2/dialog/route.ts,
    _legacy_web/app/api/communicator/v2/greeting/route.ts,
    _legacy_web/app/api/_utils/lifeSpheresBaseline.ts,
    services/communicator-client.ts,
    scripts/i18n-sync.mjs,
    scripts/i18n-sync.sh,
  ]
---

# i18n — multilingual architecture

> **Golden rule (read first).** Multilingualism is a **system invariant**, not a
> feature of one screen. Russian is the *source of truth* for authoring; the app
> must work identically in every enabled locale. Whenever a task adds or changes
> **user-facing text, the assistant's reply language, dates/numbers/plurals, or a
> new screen**, it MUST go through this module's mechanisms — never hardcode a
> Russian string in JSX or a server response. If you are unsure whether a task
> touches i18n, assume it does and check this spec.

This module is cross-cutting (client + server + build scripts). It owns *how*
language is selected, stored, resolved and rendered. The phased design/rationale
lives in `docs/04_workspace/i18n_architecture.md`; this spec describes the code as
it is now.

---

## 1. Core concepts

### 1.1 Two locales, deliberately separate
- **Input locale** — the language the user speaks/types. Drives **STT /
  transcription** only.
- **Response/UI locale** — the language the app renders and the assistant
  answers in. Drives UI strings, prompts, `languageName`, and visible-text
  builders.

They are NOT required to match. This decoupling powers **test mode**.

### 1.2 Test mode (developer)
`EXPO_PUBLIC_I18N_TEST_MODE` (client) = "speak Russian, see another language".
When on, transcription stays `ru` while UI + response follow the selected locale,
so a Russian-speaking developer can spot-check any language. In production both
follow the selected/detected locale.

### 1.3 The three text layers — never conflate
| Layer | What | Goes to LLM? | Policy |
|-------|------|--------------|--------|
| **A. Data files** | sphere/chakra characteristics, tonal registers, expert lens — fed into prompts as context | yes (input) | **RU source**; the LLM emits the target language. Do NOT translate these (decision #5). |
| **B. LLM-written text** | action names, recommendations, day paragraph, summaries | model output | **Already locale-ready** once `languageName` is set. Nothing to localize. |
| **C. Deterministic scaffolding** | server-assembled labels (`"Рекомендация:"`), dates, plurals, fallback sentences emitted when the LLM fails | no (post-processing) | **Must be localized per response locale.** Localizing is preferred over making the finale fully LLM-driven (preserves reliability). |

Consequence: layer C choices have **zero token impact** (post-processing), so token
cost never decides layer-C design.

---

## 2. Objects — client (`modules/i18n/`)

### 2.1 `localeStore.ts` — single source of truth for the active locale
- `AppLocale` = `"ru" | "en" | "de" | "fr" | "it" | "es" | "pt" | "nl"`.
- `APP_LOCALE_OPTIONS` — every target locale with `{ code, nativeLabel, enabled }`.
  `enabled` is `true` only for locales whose **content is ready** (today RU/EN).
  The Profile selector renders disabled options as "(soon)".
- `DEFAULT_APP_LOCALE = "ru"`.
- `I18N_TEST_MODE` — parsed from `EXPO_PUBLIC_I18N_TEST_MODE`.
- State: a module-level `currentLocale` + listener set (powers `useSyncExternalStore`).
- Persistence: expo-secure-store on native, `localStorage` on web (key
  `harmonizer.locale.v1`), mirroring `services/dayContentCache.ts`.
- API:
  - `hydrateAppLocale(profileLocale?)` — call once at startup (done in
    `app/_layout.tsx` `AccessBridge`); loads persisted value, else seeds from
    `users.locale`, else device. Idempotent.
  - `getAppLocale()` / `setAppLocale(locale)` / `subscribeAppLocale(cb)`.
  - `coerceAppLocale(value)` — reduce any locale-ish string to the nearest
    **enabled** locale (else default). Use this at every boundary.
  - **`getResponseLocale()`** — locale the assistant should answer in (sent as
    `responseLocale`). Synchronous; safe to call from non-React services.
  - **`getTranscribeLocale()`** — STT language; returns `"ru"` in test mode, else
    the active locale.

### 2.2 `t.ts` — translation + plurals
- JSON catalogs `catalog/{ru,en}.json` are flat dotted-key → string maps.
- `t(locale, key, params?)` — lookup with `{placeholder}` interpolation; fallback
  chain **requested → en → ru → key** (so a missing key never crashes; it renders
  the key, which is visible in QA).
- `pluralCategory(locale, count)` — CLDR plural category via **`Intl.PluralRules`**
  (this is what makes the framework language-complete: RU one/few/many, EN
  one/other, etc., with no per-language code).
- `tCount(locale, baseKey, count, params?)` — picks `${baseKey}.${category}` with
  fallback to `${baseKey}.other`; injects `{count}`.

### 2.3 Hooks
- `useAppLocale()` → `{ locale, transcribeLocale, testMode, setLocale }` (subscribes
  to the store via `useSyncExternalStore`).
- `useTranslate()` → `{ t, tc, locale }` bound to the active locale. **Prefer this
  in components.**

### 2.4 Public surface
Everything is re-exported from `modules/i18n/index.ts`. Import from `@/modules/i18n`.

---

## 3. Objects — server (`_legacy_web/app/api/_utils/dialogLocale.ts`)

- `ResponseLocale` = `"ru" | "en"` (the **supported response locales today**;
  expand only after layer C is localized for the new language — see §6).
- `resolveResponseLocale(userLocale, requestedLocale?)` — precedence:
  1. `DIALOG_RESPONSE_LOCALE` env override (headless/server test),
  2. `requestedLocale` from the request body (`responseLocale`, the in-app selector),
  3. `users.locale`,
  4. `ru`.
  Unsupported values at any level fall through. With everything unset, returns the
  exact legacy `userLocale.startsWith("en") ? "en" : "ru"` → **zero regression**.
- `localeToLanguageName(locale)` — ISO-639-1 → English language name; already covers
  all 8 targets (used for `languageName` in prompts → drives layer B).
- Wiring:
  - `dialog/route.ts` collapses the decision **once** right after loading context:
    `context.user.locale = resolveResponseLocale(context.user.locale, body.responseLocale)`.
    All downstream `resolveResponseLocale(context.user.locale)` calls,
    `lifeSpheresBaseline` selection, `sanitizeAssistantText`, and the
    `replaceSpontaneousEnglishRu` guard then agree.
  - `greeting/route.ts` uses `resolveResponseLocale(context.user.locale, body.responseLocale)`
    for author voice / address-form / sanitize.

---

## 4. The catalog + the sync gate

### 4.1 Catalog
- Source of truth: `modules/i18n/catalog/ru.json`. Targets: `en` (required) +
  `de fr it es pt nl` (best-effort). Keys are stable, sorted, dotted.
- `catalog/.sync-meta.json` records, per target locale per key, the **RU source
  value** at the time it was last translated → lets the gate detect *stale* keys
  (source changed since translation).

### 4.2 Gate — `scripts/i18n-sync.mjs`
- `check` — diffs RU source vs each locale: **missing / stale / orphan** keys.
  Exits non-zero if a **required** locale (`en`) drifts; warns for optional ones.
- `fill [--locale xx | --all]` — LLM-translates missing/stale keys from RU,
  removes orphans, updates `.sync-meta.json`. Needs `I18N_TRANSLATE_API_URL /
  _API_KEY / _MODEL`; without them it prints the plan only.
- **Diff-based**: only changed keys × target locales, so it is cheap and mostly
  idle. Adding the 6 languages later is a one-time `fill --all`.

### 4.3 Pre-push wrapper — `scripts/i18n-sync.sh`
Installed alongside docs-sync by `scripts/docs-sync/install.sh`. When a push
changes `ru.json`, it runs `fill --all`, commits updated catalogs, and never
blocks the push. Bypass: `HARMONIZER_SKIP_I18N_SYNC=1`.

---

## 5. Two-tier string strategy (IMPORTANT for new work)

There are **two** string mechanisms; pick correctly:

1. **JSON catalog + `t()`** (`modules/i18n/catalog`) — for **new** UI strings and
   simple/flat text. Gate-managed, scales to all 8 locales automatically. **Default
   choice for any new user-facing string.**
2. **Typed `get*Strings(locale)` modules** — pre-existing per-module tables
   (`modules/communicator/i18n/communicator.ts`, `modules/home/i18n/home.ts`,
   `modules/breath/i18n/coherence.ts`, `modules/profile/i18n/profile.ts`,
   `modules/.../userFacingErrors`). They are RU/EN, type-safe, and support function
   interpolation (e.g. `typingStatus: (x)=>...`). **Keep them** for complex/
   structured strings; do not force them into flat JSON.

Rules:
- A consumer must pass the **shared locale** (`useAppLocale().locale`) into
  `get*Strings`, never a hardcoded `"ru"` and never `profile.locale` directly.
- When you add a **6-language** target, the typed modules need per-locale objects
  added by hand (or via a future gate extension); the JSON catalog is filled by the
  gate. Both must be complete before a locale is flipped `enabled: true`.

---

## 6. How to add a new response language (e.g. `de`)

1. Localize **layer C** (deterministic builders/fallbacks in
   `dialogBranchPrompts.ts` / `dialogTurnGuards.ts`) for `de`, and add `"de"` to
   `SUPPORTED_RESPONSE_LOCALES` in `dialogLocale.ts`.
2. `node scripts/i18n-sync.mjs fill --locale de` to fill the JSON catalog.
3. Add `de` objects to the typed `get*Strings` modules.
4. Verify Luxon date formatting uses the `de` locale.
5. Flip `enabled: true` for `de` in `APP_LOCALE_OPTIONS`.
6. Until all of the above are done, leave `de` disabled — `resolveResponseLocale`
   rejects unsupported locales and falls back, so we never ship mixed-language output.

---

## 7. Plumbing summary (locale flow)

```
Profile selector ── setAppLocale ──▶ localeStore (persisted)
                                        │
   useAppLocale / useTranslate ◀────────┤ (UI strings)
                                        │
   getResponseLocale() ──▶ dialog POST body.responseLocale ──▶ server
                                        │                       resolveResponseLocale
   getTranscribeLocale() ──▶ transcribe language (ru in test mode)
```

---

## 8. Support matrix & known gaps

- **Enabled now:** RU, EN (UI catalog + typed modules + server layer C).
- **Pending (disabled):** DE, FR, IT, ES, PT, NL — need §6 steps.
- **Wired to the shared locale:** tab labels, Profile screen (chrome + reports),
  Home, Day assistant, Breath screen.
- **Not yet migrated (hardcoded RU, incremental):** most screen chrome outside the
  above; `modules/practices/core/catalog.ts` `createBreathPractices()` uses
  `getCoherenceBreathStrings("ru")` + `BREATH_CATALOG_DESCRIPTION_RU` (practice
  titles stay RU until the catalog build is threaded with locale);
  `AppStartupProvider` overlay uses device locale (transient, acceptable).
  Dev-only diagnostics strings are intentionally left in RU.
- **Optional later:** writing `users.locale` server-side and auto-detecting the
  input language in production (today the in-app selector drives both UI and
  `responseLocale`).
