# HARMONIZER Deploy Checklist

## Supabase Edge Functions

Required secrets for deployed functions:

- `SUPABASE_URL` - Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY` - service-role key for cron/server-side writes.
- `CRON_SECRET` - shared secret required by scheduled functions. Send it as `Authorization: Bearer <secret>` or `x-cron-secret`.
- `HARMONIZER_APP_URL` (or `VERCEL_APP_URL`) - origin of the deployed `_legacy_web` backend (no `/api` suffix). Used by Edge `precompute-global-recommendations` to call `POST /api/ai/global-content/warm` for LLM + `text_i18n` after structural upsert. Same value as `EXPO_PUBLIC_COMMUNICATOR_API_URL` in production.
- `GEMINI_API_KEY` - Gemini key for `auto-calibrate` LLM digest. If absent, `auto-calibrate` falls back to heuristic digest.

Functions to deploy:

- `auto-calibrate`
- `precompute-daily-forecasts`
- `precompute-global-recommendations`
- `cleanup-expired-proposals`
- `cleanup-expired-stories`
- `reconcile-expired-memberships`

Recommended schedules (canonical = `pg_cron` via migrations; self-healed by `ensure_harmonizer_cron_jobs`):

- `precompute-daily-forecasts` / `precompute_daily_forecasts_hourly`: `0 * * * *`
- `precompute-global-recommendations` / `precompute_global_recommendations_hourly`: `0 * * * *`
- `cleanup-expired-stories` / `cleanup_expired_stories_hourly`: `15 * * * *`
- `reconcile-expired-memberships` / `reconcile_expired_memberships_hourly`: `20 * * * *`
- watchdog `ensure_harmonizer_crons_watchdog`: `*/15 * * * *` → `select public.ensure_harmonizer_cron_jobs();`
- optional (not in ensure registry yet): `auto-calibrate` `0 3 * * *`, `cleanup-expired-proposals` `0 4 * * 0`

After DB restore / project move: run `select public.ensure_harmonizer_cron_jobs();` and confirm Vault secrets (`precompute_global_cron_secret`, cleanup/reconcile secrets) still match Edge `CRON_SECRET`.

## Next.js Backend (`_legacy_web`)

Required Vercel environment variables:

- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL for auth validation and server clients.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key for JWT validation.
- `SUPABASE_SERVICE_ROLE_KEY` - service-role key for backend writes and protected reads.
- `CRON_SECRET` - shared secret required by scheduled functions and by `POST /api/ai/global-content/warm`.
- `GEMINI_API_KEY` - Gemini key for calibration extraction, orchestrator, responder, and recommendation text.
- `AI_MODEL_STANDARD` - concrete Gemini model for `standard` prompt/scenario tier.
- `AI_MODEL_PREMIUM` - concrete Gemini model for `premium` prompt/scenario tier.
- `AI_MODEL_FALLBACK` - shared retry model for 503/429/timeout-style overloads (`gemini.ts`).
- `MAX_DIALOG_LENGTH=9` - hard stop for daily dialog v3 before forced final recommendation.
- `GEMINI_TIMEOUT_MS=90000` - Gemini request timeout for production.
- `GROQ_API_KEY` - Groq Whisper key for `/api/communicator/v2/transcribe`.
- `SENTRY_DSN=https://fa0cbb049716d242310a11464f1684e2@o4511304250884096.ingest.de.sentry.io/4511304290533456` - Sentry project DSN for backend error monitoring.

Optional environment variables:

- `SENTRY_TRACES_SAMPLE_RATE` - Sentry traces sample rate, defaults to `0.05`.
- `ALLOW_LEGACY_GEMINI_MODELS=true` - rewrites legacy `gemini-1.5-*` ids to `2.5` during migration.

## Mobile Client

Required Expo public variables for the production app build:

- `EXPO_PUBLIC_COMMUNICATOR_API_URL` - origin of the deployed `_legacy_web` backend, for example `https://your-app.vercel.app`.
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
- `EXPO_PUBLIC_SENTRY_DSN` - Sentry project DSN for frontend error monitoring.
- `EXPO_PUBLIC_APP_ENV` - app environment label, for example `production`.

Optional Expo public variables:

- `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` - explicit iOS URL scheme for Google Sign-In. If absent, `app.config.ts` derives it from `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
- `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` - frontend Sentry traces sample rate, defaults to `0.05`.

## Production SQL Migrations

Apply these migrations in timestamp order:

1. `supabase/migrations/20260423080000_init.sql`
2. `supabase/migrations/20260423080500_fix_get_user_stories.sql`
3. `supabase/migrations/20260429051600_calibration_dialogue_orchestrator.sql`
4. `supabase/migrations/20260429180000_rls_tighten_natal_forecasts_proposals.sql`
5. `supabase/migrations/20260429183000_fix_auto_calibration_proposals_missing_expires_at.sql`

After migrations, run the idempotent seed:

```bash
supabase db execute --file supabase/seed.sql
```

## Pre-Launch Verification

- `npm test` passes.
- Supabase Edge Functions are deployed with the secrets above.
- `precompute-global-recommendations` can be triggered manually with `curl -X POST "$SUPABASE_URL/functions/v1/precompute-global-recommendations" -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{}'` and returns `ok: true`.
- `user_event_log` receives `llm_prompt_size` events from `communicator/v2/dialog`, `calibration/extract`, `greeting`, and `auto-calibrate`.
- A manual calibration returns `ultraMode.enabledUntil` and writes `preferences.ultraModeUntil` in `user_settings`.

