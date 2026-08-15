---
id: 02_modules/affirmations/dependencies
title: Affirmations Dependencies
version: 1.0
updated: 2026-08-14
depends_on: [02_modules/affirmations/spec]
code_refs: [modules/affirmations/index.ts]
---

## 1. Этот модуль зависит от

| Модуль | Контракт |
|---|---|
| `subscription` / `access` | `FeatureKey affirmations`, `AccountGateDialog`, `canUseFeature` |
| `practices` | Entry widget в `PracticeCatalogScreen` |
| breath / Coherence | `AffirmationBreathOverlay` в `CoherenceBreathScreen`; day bump после results |
| `communicator` | STT `transcribeCommunicatorAudio` / Whisper 16 kHz |
| `i18n` | `affirmation.*`, `gate.body.affirmation`, `useTranslate` / `responseLocale` |
| `infra` | Supabase table + Storage; Vercel API routes; `prompts` (`affirmation_generate` / `affirmation_refinement`) |

## 2. От этого модуля зависят

| Модуль | Как |
|---|---|
| `practices` | виджет каталога |
| breath / Coherence | overlay + practice-complete |
| `subscription` | FeatureKey matrix |

## 3. Внешние

- LLM: `AI_MODEL_STANDARD` via `getModelByHint("standard")`.
- Storage bucket `affirmation-audio`.
