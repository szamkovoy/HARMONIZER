---
id: 02_modules/i18n/spec
title: i18n (Multilingual) Spec
version: 1.6
updated: 2026-06-16
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
    modules/i18n/localeCodes.ts,
    _legacy_web/app/api/_utils/dialogLocale.ts,
    _legacy_web/app/api/_utils/mathLevelI18n.ts,
    _legacy_web/app/api/_utils/mathLevelI18nTargets.ts,
    _legacy_web/app/api/communicator/v2/dialog/route.ts,
    _legacy_web/app/api/communicator/v2/greeting/route.ts,
    _legacy_web/app/api/_utils/lifeSpheresBaseline.ts,
    services/communicator-client.ts,
    scripts/i18n-sync.mjs,
    scripts/i18n-sync.sh,
    scripts/dialog-scaffold-fill.mjs,
    _legacy_web/app/api/_utils/dialogScaffold/index.ts,
    _legacy_web/data/dialog_scaffold/ru.json,
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
  `enabled` is `true` for all eight locales after bulk `fill --all` (2026-06-15).
  Layer C dialog scaffolding is localized for all eight via `dialog_scaffold` catalogs (2026-06-15).
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
    `setAppLocale` persists locally and **best-effort mirrors to `users.locale`**
    via `services/userLocaleClient.ts` (`syncUserLocaleToServer`).
  - `coerceAppLocale(value)` — reduce any locale-ish string to the nearest
    **enabled** locale (else default). Use this at every boundary.
  - **`getResponseLocale()`** — locale the assistant should answer in (sent as
    `responseLocale`). Synchronous; safe to call from non-React services.
  - **`getTranscribeLocale()`** — STT language; returns `"ru"` in test mode, else
    the active locale.

### 2.2 `t.ts` — translation + plurals
- JSON catalogs `catalog/{ru,en,de,fr,it,es,pt,nl}.json` are flat dotted-key → string maps.
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

### 2.4 `localeCodes.ts` — content locale types and helpers
- `AppContentLocale` = all 8 targets (`ru` … `nl`).
- **`inlineBaseLocale(locale)`** — `ru` for source locale, `en` for all others; selects
  the inline RU/EN base table before `mergeTypedLocale` overlay.
- **`intlLocaleTag(locale)`** — BCP 47 tag for `Intl.DateTimeFormat` (`ru-RU`, `de-DE`, …).
- `asContentLocale(value)` — coerce unknown strings to a valid `AppContentLocale` or `null`.

### 2.5 Public surface
Everything is re-exported from `modules/i18n/index.ts`. Import from `@/modules/i18n`.

---

## 3. Objects — server (`_legacy_web/app/api/_utils/contentLocales.ts`, re-exported by `dialogLocale.ts`)

Two resolvers — do not conflate layer B and layer C:

- **`AppContentLocale`** = all 8 targets (`ru` … `nl`).
- **`resolveContentLocale(userLocale, requestedLocale?)`** — layer **B** (LLM
  content: recommendations, global texts, monologue). Precedence:
  1. `DIALOG_RESPONSE_LOCALE` env override,
  2. `requestedLocale` from the request body (`responseLocale`),
  3. `users.locale`,
  4. `ru`.
- **`resolveDialogScaffoldLocale(...)`** — layer **C** (deterministic dialog
  finals/guards). Same precedence as layer B; all eight content locales resolve
  to native scaffold catalogs (no EN fallback).
- `localeToLanguageName` / `languageNameFor` — all 8 targets (drives layer B
  `languageName` in prompts).
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

### 4.1 Catalog (UI)
- Source of truth: `modules/i18n/catalog/ru.json`. Targets: `en` (required) +
  `de fr it es pt nl` (best-effort). Keys are stable, sorted, dotted.
- `catalog/.sync-meta.json` records, per target locale per key, the **RU source
  value** at the time it was last translated → lets the gate detect *stale* keys
  (source changed since translation).

### 4.1b Layer-C dialog scaffold (server)
- Source of truth: `_legacy_web/data/dialog_scaffold/ru.json` (~48 flat keys:
  `recommendationLabel`, planning finals, greetings, summary clarifiers, etc.).
- Targets: same eight locales as the UI catalog (`en` required + six optional).
- Meta: `_legacy_web/data/dialog_scaffold/.sync-meta.json` — same stale/missing
  semantics as the UI catalog.
- Runtime: `getDialogScaffoldStrings(locale)` in
  `_legacy_web/app/api/_utils/dialogScaffold/`.
- **Edit RU → run `fill --all`** (or push; pre-push hook picks it up). One-time
  bootstrap for existing files: `node scripts/i18n-sync.mjs bootstrap-dialog-scaffold-meta`.

### 4.2 Gate — `scripts/i18n-sync.mjs`
- `check` — diffs RU source vs each locale: **missing / stale / orphan** keys for
  **UI catalog**, **dialog scaffold**, and typed overlays. Exits non-zero if a
  **required** locale (`en`) drifts in catalog or scaffold; warns for optional ones.
- `fill [--locale xx | --all]` — LLM-translates missing/stale keys from RU,
  removes orphans, updates `.sync-meta.json`. Needs a chat/completions endpoint:
  explicit `I18N_TRANSLATE_API_URL / _API_KEY / _MODEL`, or fallback to
  **`DEEPSEEK_API_KEY`** + **`AI_MODEL_PREMIUM`** (else **`AI_MODEL_STANDARD`**) at
  `${DEEPSEEK_BASE_URL}/v1/chat/completions`; without credentials it prints the plan only.
- `rebuild-typed-overlays` — deletes all typed overlay JSON under
  `modules/i18n/typed/catalog/<module>/`, clears per-locale entries in
  `typed/.sync-meta.json`, regenerates `generated-overlays.ts`, then runs
  `fill` for every overlay target (de/fr/it/es/pt/nl). Use after overlay shape /
  extractor fixes.
- **Diff-based**: only changed keys × target locales, so it is cheap and mostly
  idle. Adding the 6 languages later is a one-time `fill --all`.

### 4.3 Typed-module gate (same script)
- Registry: `modules/i18n/typed/manifest.json` (home, profile, day, practices,
  communicator, breath, mandala, userErrors, chakra).
- Source: inline `const ru:` / `const en:` blocks in TS (or `chakraTypedSource.json`),
  flattened by `scripts/lib/i18n-typed.mjs` (`extractStringTree`): dotted keys,
  quoted/hyphenated object keys (e.g. `"nadi-shodhana"`), key-on-one-line with
  string value on the next line. **RU and EN stay inline** in TS; overlay JSONs under
  `modules/i18n/typed/catalog/<module>/{de,fr,it,es,pt,nl}.json` supply the other
  six locales at runtime via `mergeTypedLocale`.
- `check` / `fill --all` run typed diff for **de/fr/it/es/pt/nl** (warn until
  filled; does not hard-fail — locale stays `enabled: false` until complete).
- `fill` regenerates `modules/i18n/typed/generated-overlays.ts`.

### 4.4 Pre-push wrapper — `scripts/i18n-sync.sh`
Installed alongside docs-sync by `scripts/docs-sync/install.sh`. When a push
changes `modules/i18n/catalog/ru.json` or `_legacy_web/data/dialog_scaffold/ru.json`
(or typed-module RU sources), it runs `fill --all`, commits updated catalogs +
scaffold JSON + meta, and never blocks the push. Bypass: `HARMONIZER_SKIP_I18N_SYNC=1`.

---

## 5. Two-tier string strategy (IMPORTANT for new work)

There are **two** string mechanisms; pick correctly:

1. **JSON catalog + `t()`** (`modules/i18n/catalog`) — for **new** UI strings and
   simple/flat text. Gate-managed, scales to all 8 locales automatically. **Default
   choice for any new user-facing string.**
2. **Typed `get*Strings(locale)` modules** — pre-existing per-module tables
   (`modules/communicator/i18n/communicator.ts`, `modules/home/i18n/home.ts`, …).
   RU/EN are **inline**; de/fr/it/es/pt/nl come from **gate-managed overlay JSON**
   merged by `mergeTypedLocale(moduleId, base, locale)` in
  `modules/i18n/typed/merge.ts` — overlays are applied by **flat dotted path**
  (`flattenOverlayStrings` → `applyFlatStringOverlay`), robust to JSON nesting shape
  in generated files. `deepMergeTyped` is deprecated (delegates to the same path).
  Chakra uses the same flatten path via `applyFlatChakraOverlay`.
  Function-valued strings (e.g. `typingStatus`, `formatDateHeader`) stay in
  TS and are not gate-extracted; date/time formatters use `intlLocaleTag(locale)`.

Rules:
- A consumer must pass the **shared locale** (`useAppLocale().locale`) into
  `get*Strings`, never a hardcoded `"ru"` and never `profile.locale` directly.
- When you add a **6-language** target, run `node scripts/i18n-sync.mjs fill --all`
  (typed overlays + JSON catalog). Flip `enabled: true` only after layer C is also
  ready for that locale (see §6).

---

## 6. How to add a new response language (e.g. `de`)

Layer C for the eight shipped locales is already in `_legacy_web/data/dialog_scaffold/`.
For a **ninth** locale later:

1. Add keys to `_legacy_web/data/dialog_scaffold/ru.json` (source) and extend
   `AppContentLocale` / `SUPPORTED_RESPONSE_LOCALES` if needed.
2. `node scripts/i18n-sync.mjs fill --locale <code>` (or `fill --all`) for UI
   catalog + dialog scaffold + typed overlays.
3. Verify Luxon date formatting uses the new locale.
4. Flip `enabled: true` in `APP_LOCALE_OPTIONS`.
5. Until catalog + scaffold + typed overlays are complete, leave the locale
   disabled — `coerceAppLocale` prevents mixed-language UX.

---

## 7. Plumbing summary (locale flow)

```
Profile selector ── setAppLocale ──▶ localeStore (persisted)
        │                              │
        │                              ├── syncUserLocaleToServer ──▶ users.locale
        │                              │
   useAppLocale / useTranslate ◀────────┤ (UI strings)
                                        │
   getResponseLocale() ──▶ dialog POST body.responseLocale ──▶ server
                                        │                       resolveContentLocale (B)
                                        │                       resolveDialogScaffoldLocale (C)
   getResponseLocale() ──▶ ai/monologue + ai/global-content POST.responseLocale
                                        │                       (morning rec + free-tier texts)
   getTranscribeLocale() ──▶ transcribe language (ru in test mode)
```

---

## 8. Support matrix & known gaps

- **Enabled now:** RU, EN, DE, FR, IT, ES, PT, NL (UI catalog + typed modules + server layer B + layer C dialog scaffold).
- **Layer A (UI / typed modules):** tab labels, Profile chrome + reports, Home
  chrome, Day tab, Practices catalog, Breath, Mandala stream, chakra state labels
  (`modules/chakra/i18n.ts` — single source for legend text), startup splash footer
  (`AppStartupProvider` — catalog keys `startup.step.*`, `startup.fallback` via `t()`).
- **Layer B (LLM / server-generated):** morning recommendation, global free-tier
  slogan/short/long text, `ModalLongExplanation` body. Client sends `responseLocale`;
  server uses `resolveContentLocale` (all 8 locales) and **locale-suffixed**
  `scenario_cache` keys for `morning_recommendation`. Free-tier
  `global_daily_content`: RU canonical row + precomputed `text_i18n` jsonb
  (`pretranslateGlobalTexts` on upsert / cron). Serve path reads `text_i18n` first;
  if a target locale is missing, **`POST /api/ai/global-content`** may run
  **`ensureGlobalTextI18nPrecomputed`** on demand before responding (row-level, not
  per-user). Client `fetchGlobalContent`: Supabase SDK fallback only when
  `responseLocale === "ru"`. Math markdown via `getMathLevelStrings(locale)` in
  `mathLevelI18n.ts` — RU/EN inline; de/fr/it/es/pt/nl in `mathLevelI18nTargets.ts`.
- **Layer C (deterministic server strings):** dialog branch finals, guards,
  greetings, planning labels, summary bridges — all eight locales via
  `_legacy_web/data/dialog_scaffold/*.json` and `getDialogScaffoldStrings()`.
  RU source syncs via `node scripts/i18n-sync.mjs fill --all` (same gate as UI
  catalog). Exception: `practiceCardSummary.ts` breath-slug blurbs still use
  RU copies / EN fallback for non-RU (not scaffold JSON).
- **Still hardcoded / incremental:** dev diagnostics card on Profile; some Home
  dev-only strings (`NatalBridgeCard`); event banner text if server-supplied;
  `ModalLongExplanation` body comes from LLM (layer B) — UI shell is localized.
- **Per-locale checklist when enabling a new language:** JSON catalog (`fill`),
  typed overlay JSON (`fill --all`), layer C builders, Luxon verify, then flip
  `enabled: true`. Run `node scripts/i18n-sync.mjs check`.
- **Optional later:** auto-detecting input language in production (today the
  selector drives UI + `responseLocale`; `users.locale` is mirrored on change).
