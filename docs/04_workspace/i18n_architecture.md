---
id: 04_workspace/i18n_architecture
title: Multilingual (i18n) Architecture — Design
version: 0.2
updated: 2026-06-14
depends_on: [02_modules/assistant/spec, 02_modules/communicator/spec, 00_index/CHANGELOG]
code_refs: [_legacy_web/app/api/_utils/dialogLocale.ts, _legacy_web/app/api/communicator/v2/dialog/route.ts, _legacy_web/app/api/communicator/v2/greeting/route.ts, _legacy_web/app/api/_utils/lifeSpheresBaseline.ts, _legacy_web/data/life_spheres_baseline/ru.json, _legacy_web/data/chakra_states_baseline.json, modules/communicator/i18n/communicator.ts, modules/i18n/localeStore.ts, modules/i18n/t.ts, modules/i18n/catalog/ru.json, scripts/i18n-sync.mjs, scripts/i18n-sync.sh]
---

# Multilingual architecture for HARMONIZER

Status: **Phase 1 done; Phase 2 framework + plumbing landed (content migration
incremental); Phase 3 pending.** This doc captures the agreed decisions and the
phased plan so we can extend languages without per-language prompt forks and
without regressing the working RU dialog.

## Agreed decisions (2026-06-14)

1. **Two locale concepts, deliberately separate:**
   - **Input locale** — the language the user speaks/types (drives STT /
     transcription).
   - **Response locale** — the language the assistant answers in (drives prompts
     + visible-text builders + UI strings).
   They are NOT required to match. This enables the test mode below.
2. **Test mode (now):** an **ENV flag** forces the response locale while the user
   keeps speaking Russian. Implemented as `DIALOG_RESPONSE_LOCALE` (server).
   When set (e.g. `en`), the assistant answers in that language regardless of the
   user's stored `users.locale`; transcription stays Russian (client unchanged).
3. **Production mode (later):** auto-detect the input language (or use the app
   language setting) and respond in the same language.
4. **First languages:** **RU + EN** fully; DE / FR / IT / ES / PT / NL framed for
   later (see Phase 3).
5. **Data files stay in Russian** (sphere characteristics, chakra states, tonal
   registers, expert lens). Rationale: dialog output is LLM-generated in the
   target language, so the data-file language is decoupled from output; the RU
   source is hand-tuned and richer, and one-language source is far easier to
   evolve. Token cost of RU context is higher but a small slice of the prompt —
   not worth the quality/maintenance risk of translating the curated source.
   The data-file language is kept a **single config point** so it can switch
   later if token cost ever matters. (`life_spheres_baseline` already ships
   `ru.json` + `en.json`; the resolver picks by response locale.)
6. **UI strings:** localized statically per locale (resource tables), NOT
   LLM-translated at runtime.

## Current reality (audited 2026-06-14)

- `users.locale` (default `ru`) is **read** server-side but **never written** by
  the app; the dialog POST body carries `userTimezone` only (no language).
- Dialog prompts derive `languageName`/`locale` in `buildBrainPromptContext`
  (`dialog/route.ts`). Deterministic visible-text builders in
  `dialogBranchPrompts.ts` / `dialogTurnGuards.ts` are **ru/en only**.
- Data files: `life_spheres_baseline/{ru,en}.json` (locale-aware);
  `chakra_states_baseline.json`, `dialogTonalRegisters.ts`, `chakra/labels.ts`,
  `planet_chakra_map.json` are **Russian only**; `author_voice.json` is bilingual.
- Client: no i18n framework; ~5 ad-hoc `get*Strings(locale)` module tables
  (communicator, home, breath, profile, userErrors) + ~45–55 files with
  hardcoded Russian; several screens hardcode `locale="ru"` (Day, Breath,
  Profile) even though Home aligns to `profile.locale`.
- Transcription DOES send a language (`transcribeLanguage` ru/en) per UI locale.
- Region features: subscription gating is by **tier only** (no geo); Stories has
  DB + dialog entry but **no Expo UI** yet. No payment-provider integration.

## Phase 1 — response-locale foundation (LANDED)

New `_legacy_web/app/api/_utils/dialogLocale.ts`:
- `resolveResponseLocale(userLocale)` — priority: `DIALOG_RESPONSE_LOCALE` env
  override (validated against supported `ru`/`en`) → user's stored locale → `ru`.
- `localeToLanguageName(locale)` — ISO-639-1 → English language name, already
  covering the 8 target languages (for `languageName` in prompts).

Wired into:
- `dialog/route.ts`: `buildBrainPromptContext` uses `resolveResponseLocale` and
  `localeToLanguageName`; `lifeSpheresBaseline` now selected by response locale;
  all ~9 in-handler `locale` derivations, the 4 `sanitizeAssistantText` calls,
  and the `replaceSpontaneousEnglishRu` guard now go through the resolver.
- `greeting/route.ts`: author voice, address-form hint and sanitize use the
  resolved response locale, so the opening message also follows the test flag.

**Zero-regression guarantee:** with `DIALOG_RESPONSE_LOCALE` unset, the resolver
returns exactly the old `userLocale.startsWith("en") ? "en" : "ru"` result, so
behavior is identical to before.

**How to test now (RU in → EN out):** set `DIALOG_RESPONSE_LOCALE=en` in
`_legacy_web/.env.local` (and Vercel for remote), restart. Speak Russian; the
assistant answers in English. Unset to return to normal.

## Phase 2 — production language selection + client plumbing (FRAMEWORK + PLUMBING LANDED)

Landed this session:
- **Client i18n core** `modules/i18n/`:
  - `localeStore.ts` — single source of truth for the active app locale
    (UI + response). Persisted via expo-secure-store / web-localStorage; hydrated
    at startup (`hydrateAppLocale`, seeded from `profile.locale`). Sync getters
    `getResponseLocale()` / `getTranscribeLocale()` for non-React services.
    `APP_LOCALE_OPTIONS` lists all 8 with an `enabled` flag (RU/EN on; others off
    until their catalog content is filled). `I18N_TEST_MODE` from
    `EXPO_PUBLIC_I18N_TEST_MODE`.
  - `t.ts` — `t(locale,key,params)` + `tCount(locale,base,count)` with plural via
    `Intl.PluralRules` (language-complete: RU one/few/many, etc.). JSON catalogs
    `catalog/{ru,en}.json`; lookup falls back requested → en → ru → key.
  - `useAppLocale()` / `useTranslate()` React hooks.
- **Profile** has a language selector (writes the store; persisted). In test mode
  it shows the "speak Russian, see selected language" note.
- **Plumbing**: the dialog POST body now carries `responseLocale`
  (`getResponseLocale()`); server precedence is env override → body → `users.locale`
  → `ru` (`resolveResponseLocale(userLocale, requestedLocale)`). Transcription uses
  `getTranscribeLocale()` (stays `ru` in test mode).
- **Repointed** `Day`, `Breath` (and Profile reports) off hardcoded `locale="ru"`
  onto the shared app locale. Tab labels go through the catalog.
- **Sync gate** `scripts/i18n-sync.mjs` (`check` / `fill`) + `scripts/i18n-sync.sh`
  pre-push wrapper (installed by `scripts/docs-sync/install.sh`). See below.

Still TODO in Phase 2 (incremental, gated):
- Migrate the remaining hardcoded-RU screens and the ad-hoc `get*Strings` tables
  into the catalog (the gate flags gaps; RU/EN required).
- Optionally write `users.locale` server-side and auto-detect input language for
  production (today the in-app selector drives both UI and `responseLocale`).

## Three layers — do not conflate (clarified 2026-06-14)

A common confusion: "keep templates in Russian and let the LLM generate the
finale" mixes three different layers. They are handled differently:

| Layer | What | Tokens to LLM? | Policy |
|-------|------|----------------|--------|
| **A. Data files** (sphere/chakra characteristics, tonal registers, expert lens) | prompt CONTEXT fed in | yes (input) | **RU source**, LLM outputs target language (decision #5). EN-translation token saving is small, not worth the quality/maintenance risk. |
| **B. LLM-written text** (action names, recommendations, day paragraph, summaries) | model OUTPUT | n/a (output) | **Already language-ready**: works for any language once `languageName` is set. Nothing to do. |
| **C. Deterministic scaffolding** (`"Рекомендация:"` label, date label, plural of "action", deterministic fallback sentences when the LLM fails) | server-side assembly AFTER the LLM | **no (post-processing, 0 tokens)** | Must be localized per response locale (see below). |

Key consequence: choosing how to handle layer C has **no token impact** (it is
post-processing, not prompt input), so token cost is NOT a deciding factor there.

## Phase 3 — beyond RU/EN (DE/FR/IT/ES/PT/NL) (TODO)

Only layer **C** blocks new response languages (layer A stays RU, layer B is
already LLM-driven). Two options for layer C:

- **(a) Localize the scaffolding strings** — translate the small set of labels /
  fallback sentences; dates use Luxon's locale support. **Preferred** — the set
  is small and mechanical, and it **preserves the deterministic reliability** we
  built (salvage logic exists precisely because flash mis-formats free-form
  finales).
- **(b) Make the finale fully LLM-driven** — drop deterministic assembly.
  **Rejected as the default**: it would re-introduce the unreliability (forgotten
  markers, wrong action counts, broken formatting) that the deterministic builders
  were created to fix. (Earlier draft of this doc wrongly preferred (b).)

Until layer C is localized for a language, `resolveResponseLocale` rejects that
locale and falls back, to avoid shipping mixed-language output.

## Decision (2026-06-14): build Option A now

Build the **framework fully language-capable** (plural via `Intl.PluralRules`,
locale-aware date/number formatting, 8-locale-ready key schema) and fill **RU/EN
content** now. The other six languages are added later by a one-command bulk
translation through the sync gate. Rationale: the framework is the only
hard-to-change-later part — getting it right means deferring the 6 languages'
*content* causes no structural rework, keeps review focus on RU/EN, and keeps the
gate cost minimal (it is diff-based — see below).

## Translation sync gate (the "keep translations in sync" process)

Mirrors the docs auto-update hook. Source of truth = the **Russian** catalog
(dev stays Russian-first).

- **Diff-based**, NOT a full re-scan: on commit/pre-push the gate compares the RU
  source catalog against each locale file **by key** (storing the source value/
  hash per key). Only **changed / added / removed** keys are acted on.
- **Cost**: ≈ (changed keys) × (target locales), and only when UI text is edited
  (rare). 8 languages vs 2 multiplies only that small per-edit delta, never the
  whole catalog. The gate is effectively idle most of the time.
- **Modes**: `check` (fail if any locale is missing/stale keys — RU/EN required,
  others best-effort) and `check + LLM-fill` (auto-translate missing keys via LLM
  for review). Chosen: **check + LLM-fill**.
- **Why deferring the 6 languages is safe**: the gate first maintains RU↔EN; a
  later one-time `fill` translates the whole catalog into the other six, after
  which the gate maintains all eight automatically.

## Test workflow (developer, RU-first)

- Profile has a **language selector**. The selected locale drives UI strings AND
  the `responseLocale` sent to the dialog/greeting API.
- **Test mode** (`EXPO_PUBLIC_I18N_TEST_MODE`): you keep speaking **Russian**
  (transcription stays `ru`) while the assistant + UI answer in the selected
  language — so you can spot-check any language without learning to speak it.
- **Production**: transcription follows the selected/detected language (input
  language == response language).
- Server precedence for response locale: `DIALOG_RESPONSE_LOCALE` env override →
  request body `responseLocale` → `users.locale` → `ru`.

Also: `chakra_states_baseline.json` / `dialogTonalRegisters.ts` / `chakra/labels`
stay RU source per decision #5 (LLM translates into the target language); revisit
only if token cost becomes a real constraint.

## Region-specific features (later)

- Payments: no provider yet; when added, gate by store region/currency
  independently of response locale.
- Stories: not on client yet; localize content via the existing `{ru,en}` jsonb
  columns when the UI lands.
