---
id: 02_modules/i18n/spec
title: i18n (Multilingual) Spec
version: 1.16
updated: 2026-07-17
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
    app.config.ts,
    plugins/appLocalesData.js,
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
    supabase/functions/send-auth-email/index.ts,
    supabase/functions/send-auth-email/templates/ru.json,
    supabase/functions/send-auth-email/templates.ts,
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
`EXPO_PUBLIC_I18N_TEST_MODE` (client) now flips the **voice reply-locale policy**.
When on, the app UI still follows the selected locale, but voice turns omit the STT
language hint, Whisper auto-detects the spoken language, and the assistant replies
in that detected speech language for that turn. When off, both UI and assistant
reply stay on the selected/profile locale; voice STT defaults to that locale too.

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
- **`deviceLocale()`** — first-launch device language. Reads the OS **ordered** list of
  preferred languages via `expo-localization` `getLocales()` and returns the first that
  matches an **enabled** app locale (correctly handles an unsupported primary, e.g.
  `zh`/`kk`, with a supported second preference). Terminal fallback is **English**
  (`DEVICE_LOCALE_FALLBACK = "en"`, per product decision: an unknown user gets EN,
  not RU); `ru` remains the ultimate last resort via `DEFAULT_APP_LOCALE` if `en` is
  somehow disabled. Previously used `Intl.DateTimeFormat().resolvedOptions().locale`
  (single primary locale only).
- `I18N_TEST_MODE` — parsed from `EXPO_PUBLIC_I18N_TEST_MODE`.
- State: a module-level `currentLocale` + listener set (powers `useSyncExternalStore`).
- Persistence: expo-secure-store on native, `localStorage` on web (key
  `harmonizer.locale.v1`), mirroring `services/dayContentCache.ts`.
- API:
  - `hydrateAppLocale(profileLocale?)` — called from `app/_layout.tsx`
    `AccessBridge` whenever `profile?.locale` changes. **Account locale wins:**
    `users.locale` overrides a sticky SecureStore value left by a previous
    account on the same device; if profile is not loaded yet, SecureStore/device
    is used, then a later call adopts `profileLocale` when it arrives or the
    account switches. **Always write-back** resolved locale to `users.locale`
    so push language cannot drift from SecureStore.
  - `getAppLocale()` / `setAppLocale(locale)` / `subscribeAppLocale(cb)`.
    `setAppLocale` persists locally and mirrors to `users.locale`
    via `services/userLocaleClient.ts` (`syncUserLocaleToServer`) even when
    the in-memory locale is unchanged (heals DB drift).
  - `coerceAppLocale(value)` — reduce any locale-ish string to the nearest
    **enabled** locale (else default). Use this at every boundary.
  - **`getResponseLocale()`** — locale the assistant should answer in (sent as
    `responseLocale`). Synchronous; safe to call from non-React services.
  - **`getTranscribeLocale()`** — default STT/input locale; always returns the
    active locale. Sent to dialog POST as **`inputLocale`** so the server can
    remind the model not to mirror the user's input language when it differs from
    `responseLocale`. The communicator voice flow may still override both locales
    per turn (`resolveVoiceTurnLocales` in i18n test mode after Whisper
    auto-detect).

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
- **`formatRelativeTime(isoOrDate, locale, now?)`** — относительные метки с **сокращёнными** единицами (`15 мин`, `2 h`, `3 дн`); одна доминирующая единица (часы без минут, дни без часов). Каталог без склонений. Hermes не реализует `Intl.RelativeTimeFormat`, поэтому Luxon `toRelative()` на RN не используется.
- **`pickLocalizedText` / `pickLocalizedUrl` / `hasLocalizedTitle`** — soft chain preferred → en → ru (notifications push/inbox).
- **`pickExactLocalizedText` / `pickExactLocalizedUrl` / `hasExactLocalizedTitle`** — только активная локаль; Videos/Webinars feed и announce UI.
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

### 3.3 Server layer-C / STT fallbacks (RU as ultimate fallback)
- `_legacy_web/app/api/_utils/whisperPrompts.ts` — `getDomainPrompt(language?)`: известная локаль → свой промпт (`ru`/`en`); поддерживаемая европейская без dedicated-промпта (`de/fr/it/es/pt/nl`) → мультиязычный `AUTO_DETECT_DOMAIN_PROMPT`; **неизвестная/отсутствующая → русский**. `normalizeWhisperLanguage(language?)` всегда возвращает строку (`string`), неизвестная/отсутствующая локаль → `"ru"` (ранее `undefined` → авто-детект Whisper).
- `_legacy_web/app/api/_utils/authorVoice.ts` — `getAuthorVoice(language?)`: `ru`→RU-профиль, `en`→EN-профиль, поддерживаемые европейские (`de/fr/it/es/pt/nl`) переиспользуют EN-каденс (нативного профиля нет), **неизвестная/отсутствующая → RU-профиль** (ранее → EN).
- Соответствует i18n-инварианту: русский — источник истины и конечный fallback (`resolveResponseLocale` оканчивается на `ru`).

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

### 4.1c Auth-email templates (edge function, 2026-07-14, updated 2026-07-17)
- Source of truth: `supabase/functions/send-auth-email/templates/ru.json`
  (subject/greeting/greetingName/intro/expiry/ignore/guideTitle/guide1–guide5/closing for OTP
  sign-in emails). The `footer` line was removed; a 5-step quick user guide and a
  personal signature were added (2026-07-17). `greetingName` (with `{name}`)
  was added for the named greeting (2026-07-17).
- Targets + meta: same flat-source mechanics as the dialog scaffold
  (`templates/{en,de,fr,it,es,pt,nl}.json` + `templates/.sync-meta.json`);
  registered in `i18n-sync.mjs` as the `auth-email` flat source.
- Runtime: the edge function imports the JSONs at deploy time and picks the
  template by **live sign-in UI locale** from `signin_name_hints.locale`
  (written by the client with `getResponseLocale()` before `signInWithOtp`),
  then falls back to `user_metadata.locale`, then `ru`. Relying only on
  `user_metadata.locale` is wrong for returning users: GoTrue does not update
  metadata on subsequent OTP requests.
- **Placeholders removed (2026-07-17):** the app name and the «Что делать?»
  button label are baked directly into each locale's template text — no
  `{app}`/`{cta}` runtime substitution. Since every template is fully in one
  language, there is no risk of a mismatch (a French email uses the French
  template, which already contains «Harmoniseur» and «Que faire ?»). The CTA
  string in each template matches exactly `recommendation.discussButton` in
  `modules/home/i18n/home.ts` (RU «Что делать?», EN «What to do?», DE «Was tun?»,
  FR «Que faire ?», IT «Cosa fare?», ES «¿Qué hacer?», PT «O que fazer?»,
  NL «Wat te doen?»). Only `{code}` (the OTP) is still substituted at render.
- **Sender name + signature (2026-07-17):** the `From` display name and the body
  signature use a `SENDER_NAMES` map — RU «Сергей Замковой», all other locales
  «Sergei Zamkovoi» (override via `MAIL_FROM_NAME` env). The previous behavior
  (localized app name as `From`) was replaced per product request.
- **HTML body + named greeting (2026-07-17):** the HTML body is a structured
  inline-CSS layout (max-width 600, system font-stack, sage-green letter-spaced
  code, left-accent guide block, tight signature). It uses **no external
  resources** — no Tailwind Play CDN `<script>`, no Google Fonts `<link>`,
  because email clients strip `<script>` and most strip `<link>` (the approved
  mockup only renders in a browser). A per-locale `greetingName` template with a
  `{name}` placeholder is used when the user's name is available; otherwise the
  generic `greeting` is used. Locale-appropriate greeting punctuation is baked in (RU
  «Здравствуйте, {name}!», FR «Bonjour {name} !», ES «¡Hola, {name}!», etc.).
  Plain-text body remains single-`\n`-joined.
- **Name + locale side-channel (2026-07-17 name; 2026-07-20 locale):**
  `signInWithOtp` does NOT update `user_metadata` for an existing user (only on
  creation). Without a side-channel the hook would see a stale
  `full_name` / `locale` from first registration (e.g. wizard UI `ru` + email
  template `pt`). Table `public.signin_name_hints (email PK, name, locale,
  updated_at)` + RPC `set_signin_name_hint(p_email, p_name, p_locale)`
  (migrations `20260717130000`, `20260720095058`). Client upserts typed name +
  `getResponseLocale()` before OTP; edge function reads both via service-role
  REST. Priority: hint → `user_metadata` → generic greeting / `ru`. After
  successful `verifyOtp`, client also `updateUser({ data: { locale } })` to heal
  auth metadata for the next time.
- SMTP transport (2026-07-15): rewritten to use built-in `Deno.connectTls`
  (raw SMTP: EHLO → AUTH LOGIN → MAIL FROM → RCPT TO → DATA → QUIT) instead of
  the `denomailer` module which was unavailable for Supabase Edge Function
  bundling. Secrets: `SMTP_USERNAME`, `SMTP_PASSWORD`, `SEND_EMAIL_HOOK_SECRET`.

### 4.1d Native app name & iOS permission reasons (build-time, 2026-07-17)
- Localized app **display name** (under the icon + in system permission/notification
  dialogs) and iOS **permission reason strings** are configured at prebuild time,
  not in `modules/i18n` runtime code:
  - `app.config.ts` exposes `expo.locales` (built from `plugins/appLocalesData.js`):
    per-locale `{ ios: { CFBundleDisplayName, NSXxxUsageDescription… },
    android: { app_name } }`. Expo's `withLocales` writes iOS
    `<lang>.lproj/InfoPlist.strings` and Android `res/values-<lang>/strings.xml`.
  - `ios.infoPlist.CFBundleLocalizations` declares the 8 supported locales so iOS
    system dialogs render in the device language.
  - Localized brand: RU «Гармонизатор», EN «Harmonizer», DE «Harmonisierer»,
    FR «Harmoniseur», IT «Armonizzatore», ES «Armonizador», PT «Harmonizador»,
    NL «Harmoniseerder». Fallback for an unsupported device locale → base
    `Harmonizer`.
- This is part of the i18n system invariant (one brand per locale across icon,
  system dialogs, OTP email) but lives in native config; the runtime `modules/i18n`
  store is independent (in-app language can differ from the device language, and the
  home-screen name follows the device language, not the in-app choice — OS limitation).

### 4.2 Gate — `scripts/i18n-sync.mjs`
- `check` — diffs RU source vs each locale: **missing / stale / orphan** keys for
  **UI catalog**, **flat sources** (dialog scaffold + auth-email templates), and
  typed overlays. Exits non-zero if a
  **required** locale (`en`) drifts in catalog or a flat source; warns for optional ones.
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
  communicator, breath, mandala, userErrors, chakra, charts).
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
   getTranscribeLocale() ──▶ dialog POST body.inputLocale (default STT = active locale; Communicator may override per voice turn in i18n test mode)
```

---

## 8. Support matrix & known gaps

- **Enabled now:** RU, EN, DE, FR, IT, ES, PT, NL (UI catalog + typed modules + server layer B + layer C dialog scaffold).
- **Layer A (UI / typed modules):** tab labels, Profile chrome + reports, Home
  chrome, Day tab, Practices catalog, Breath, Mandala stream, chakra state labels
  (`modules/chakra/i18n.ts` — single source for legend text), charts donut center
  label (`getChartStrings` → `balanceLabel`; overlays `typed/catalog/charts/*`), Home
  `ChakraFlower` center planet name via **`getHomeStrings` → `planetLabels`**, Home **`OpportunityWindows`** via template strings (`paidIntroTemplate`, detail/help) rebound after overlay merge, Home astro-chart zodiac labels via **`getHomeStrings().astroChartModal.zodiacSigns`**, startup splash footer
  (`AppStartupProvider` — catalog keys `startup.step.*`, `startup.fallback` via `t()`). Practices/Breath typed strings now also cover BLE-specific source labels (`camera / Bluetooth / no sensor`), the reusable activation copy for the breathing screen, and results-modal interpretation states (`Interpretation`, loading, retry/error). Locales without explicit typed overlay continue to fall back to EN base strings until dedicated overlays are filled.
- **Layer B (LLM / server-generated):** morning recommendation, global free-tier
  slogan/short/long text, `ModalLongExplanation` body. Client sends `responseLocale`;
  server uses `resolveContentLocale` (all 8 locales) and **locale-suffixed**
  `scenario_cache` keys for `morning_recommendation`. Free-tier
  `global_daily_content`: RU canonical row + precomputed `text_i18n` jsonb
  (`pretranslateGlobalTexts` on upsert / cron for **active** user locales via
  `listActiveTargetLocales`; unused languages skipped). Serve path reads `text_i18n` first;
  if a target locale is missing, **`POST /api/ai/global-content`** returns immediately
  with RU fallback via `pickGlobalTexts` and schedules **background**
  `backfillGlobalTextI18n` for the requested locale only (no blocking LLM on the
  request path). Client `fetchGlobalContent`: Supabase SDK fallback on HTTP
  failure/timeout for **any** locale, with client-side `text_i18n` pick. Math markdown via `getMathLevelStrings(locale)` in
  `mathLevelI18n.ts` — RU/EN inline; de/fr/it/es/pt/nl in `mathLevelI18nTargets.ts`. Этот deterministic слой локализует не только заголовки, но и planet/sign/aspect/tone labels, а client direct fallback пересобирает free `math_level.markdown` из `structured.chart_mode="transit_only"`, чтобы route timeout не возвращал mixed-language formulas.
- **Layer C (deterministic server strings):** dialog branch finals, guards,
  greetings, planning labels, summary bridges — all eight locales via
  `_legacy_web/data/dialog_scaffold/*.json` and `getDialogScaffoldStrings()`.
  RU source syncs via `node scripts/i18n-sync.mjs fill --all` (same gate as UI
  catalog). Exception: `practiceCardSummary.ts` detailed breath-slug blurbs remain
  RU/EN only; generic meditation/yoga/card-reason fallbacks are inline for all 8
  locales (not scaffold JSON).
- **Still hardcoded / incremental:** dev diagnostics card on Profile; some Home
  dev-only strings (`NatalBridgeCard`); event banner text if server-supplied;
  `ModalLongExplanation` body comes from LLM (layer B) — UI shell is localized.
- **Per-locale checklist when enabling a new language:** JSON catalog (`fill`),
  typed overlay JSON (`fill --all`), layer C builders, Luxon verify, then flip
  `enabled: true`. Run `node scripts/i18n-sync.mjs check`.
- **Current production behavior:** outside test mode communicator voice turns keep
  the assistant reply on the shared profile/app locale. `EXPO_PUBLIC_I18N_TEST_MODE`
  enables the opposite QA path: voice turns may auto-detect the spoken language and
  temporarily reply there, while the non-dialog UI still follows the shared locale.
