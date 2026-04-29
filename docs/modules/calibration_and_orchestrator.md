# Calibration and Dialogue Orchestrator

## M3 Calibration

`POST /api/calibration/extract` runs on the Next.js backend in `_legacy_web`.

Request:

```json
{
  "source": "initial",
  "feedbackText": "Текст голосовой обратной связи",
  "language": "ru"
}
```

For `source = "auto_aggregated"`, send either `conversationDigest` or `feedbackText`.

Backend flow:

1. Validates Supabase JWT and derives `user_id`.
2. Loads active `user_natal_charts` and active previous `user_calibrations`.
3. Loads `calibration_extraction` from `prompts`.
4. Calls Gemini for structured deltas and vocabulary.
5. Recalculates `S_calibrated` and `H_calibrated` from natal values with `(original + user_proposed) / 2`.
6. Builds `states_map` and `user_lexicon`.
7. Saves a new active calibration version and deactivates the old one.
8. Invalidates cached `user_daily_forecasts` from today onward.

In non-production, `debugExtraction` can be passed to test deterministic calibration without a Gemini call.

## M4 Orchestrator Start

Seed data in `supabase/seed.sql` creates:

- `orchestrator_decision` prompt for phase selection.
- `responder_main` prompt for user-visible replies.
- Calibration phases: `welcome_and_hint`, `listen_user`, `deepen_specific_chakra`, `acknowledge_and_close`.
- Daily dialog phases: `contextual_greeting`, `collect_state`, `deepen_inquiry`, `offer_insight`, `ask_practice_intent`, `suggest_practice`, `confirm_and_close`.

The key invariant for daily dialog is: `offer_insight` must happen before practice selection. The responder prompt also repeats this rule so the insight-goal remains explicit even when the orchestrator moves quickly.
