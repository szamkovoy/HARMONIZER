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

### Three lanes (side-by-side on one phone)

`APP_VARIANT` (via `eas.json` → `env`) changes **display name** and **bundle / package id** so installs do not overwrite each other:

| Lane | Home-screen name | iOS bundle id | Android package | How you run | Env source |
| --- | --- | --- | --- | --- | --- |
| **Dev (QR)** | Harmonizer **Expo** | `…harmonizer.dev` | `…harmonizer.dev` | `eas build --profile development` once, then daily `npx expo start --dev-client` | `.env.local` |
| **Testers** | Harmonizer **Test** | `…harmonizer.preview` | `…harmonizer.preview` | `eas build --profile preview` → APK / internal link | EAS **`preview`** |
| **Store / TestFlight** | Harmonizer | `…harmonizer.app` | `com.zamkovoi.harmonizer` | `eas build --profile production` | EAS **`production`** |

**Important:** Apple TestFlight always uses the **production** bundle id. Installing TestFlight will offer to replace the store/TestFlight app — that is normal. It must **not** replace «Harmonizer Expo» / «Harmonizer Test» once those use `.dev` / `.preview` ids (rebuild those profiles after this change).

`.env.local` is **never** uploaded to EAS cloud builds. If a variable is only in `.env.local`, store/TestFlight builds will miss it (classic symptom: «Supabase is not configured»).

`--local` on Android only runs **that one** build on your Mac (needs Android SDK). It does **not** make Expo/dev/test/prod generally faster.

Before every store build:

```bash
npm run check:eas-env -- production
```

Required EAS **production** (and usually **preview**) client vars:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_COMMUNICATOR_API_URL` — Vercel origin, no `/api` suffix
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` — Android maps
- `GOOGLE_SERVICES_JSON` — EAS file secret for FCM
- `EXPO_PUBLIC_APP_ENV` — e.g. `production`

Also useful: `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`.

Legacy Google Sign-In client ids may still sit in **development** EAS env; OTP-only auth does not require them in production.

### Rebuild after env changes

Changing EAS env does **not** patch an already-uploaded AAB/IPA. Rebuild + resubmit.

### iOS capability sync workaround

If `eas build -p ios` fails on `APPLE_ID_AUTH` / «bundle cannot be deleted»:

```bash
EXPO_NO_CAPABILITY_SYNC=1 npx eas-cli build --platform ios --profile production --no-wait
```

### Submit

```bash
npx eas-cli submit --platform ios --latest
```

`ascAppId` is in `eas.json` → `submit.production.ios`. Android: upload `.aab` in Play Console (or `eas submit -p android` once Play credentials exist).

### Local Android AAB (optional, faster than cloud queue)

On this Mac (Homebrew, no Android Studio GUI required):

- `JAVA_HOME` → `/opt/homebrew/opt/openjdk@17/...`
- `ANDROID_HOME` → `/opt/homebrew/share/android-commandlinetools`
- (already added to `~/.zshrc` — open a **new** terminal tab)

Then:

```bash
npm run check:eas-env -- production
npx eas-cli build --platform android --profile production --local
```

You do not need to open Android Studio daily — same idea as Expo: tools sit in the background for the terminal.

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

