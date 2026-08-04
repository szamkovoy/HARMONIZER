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
| **Testers** | Harmonizer **Test** | `…harmonizer.preview` | `…harmonizer.preview` | `eas build --profile preview --local` → APK | EAS **`preview`** |
| **Store / TestFlight** | Harmonizer | `…harmonizer.app` | `com.zamkovoi.harmonizer` | `eas build --profile production --local` | EAS **`production`** |

**Important:** Apple TestFlight always uses the **production** bundle id. Installing TestFlight will offer to replace the store/TestFlight app — that is normal. It must **not** replace «Harmonizer Expo» / «Harmonizer Test» once those use `.dev` / `.preview` ids (rebuild those profiles after this change).

### App version (marketing + build)

Three different numbers — do not mix them up:

| What | Where | Who bumps it |
| --- | --- | --- |
| **Marketing** `MAJOR.MINOR.PATCH` | `expo.version` in `app.json` (+ mirrored in `package.json`) | **Manual** when shipping a meaningful release (e.g. 1.2.2 → 1.2.3). Current: **1.2.2**. |
| **Android `versionCode`** | `expo.android.versionCode` | **EAS autoIncrement** on every `production` / `preview` build |
| **iOS `buildNumber`** | `expo.ios.buildNumber` | **EAS autoIncrement** on every `production` / `preview` build |

EAS: `cli.appVersionSource: "local"`; `autoIncrement: true` on **production** and **preview**.  
Rule of the increment: **AAB/IPA gets `(value in app.json) + 1`**, then EAS writes that new value back into `app.json`.

Play / App Store do **not** invent the next build number. They only reject a code that was already uploaded (including draft / library artifacts — not only what testers currently see).

#### Routine store build (no agent reminder needed)

```bash
npm run build:android:prod   # autoIncrement android.versionCode
npm run build:ios:prod       # autoIncrement ios.buildNumber
```

After a **successful** local prod build:

1. **Commit `app.json`** if `versionCode` / `buildNumber` changed (script `scripts/after-store-build.mjs` prints the values).
2. Upload that artifact **once** (`npm run submit:android` / `submit:ios` or Console).
3. Do **not** re-upload the same AAB/IPA. Do **not** hand-edit `versionCode` / `buildNumber` before the next prod build.

You do **not** need to tell the agent to “increment the Google/Apple build” for a normal release — Android and iOS both auto-increment via the same EAS setting.

#### Only bump marketing version by hand

When changing `1.2.x` → next marketing version, bump **`expo.version`** (and root `package.json` version).  
**Leave** `android.versionCode` and `ios.buildNumber` alone — the next `build:*:prod` will autoIncrement them.

#### Recovery only (Play/App Store «already used»)

If Console rejects a code that is already in its artifact library:

1. Open Play **App bundle explorer** (or App Store build list) and note the **highest used** integer.
2. Set `app.json` to that **highest used** value (not “desired next”).
3. Next `build:*:prod` produces **highest + 1**.
4. Commit `app.json`, upload **once**.

Agents must follow `.cursor/rules/store-build-version.mdc` — no routine hand-bumps of store build integers while `autoIncrement` is on.

`.env.local` is **never** uploaded to EAS (cloud or local credential fetch still uses EAS env for `EXPO_PUBLIC_*` on profile). If a variable is only in `.env.local`, store builds will miss it (classic symptom: «Supabase is not configured»).

### Default: local EAS builds (not expo.dev cloud)

Free plan ≈ **30 cloud builds/month**; queues are often hours. On this Mac **always prefer `--local`**. Do **not** start cloud builds unless explicitly asked. Agent rule: `.cursor/rules/eas-local-builds.mdc`.

Before every store build:

```bash
npm run check:eas-env -- production
```

Required EAS **production** (and usually **preview**) client vars:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_COMMUNICATOR_API_URL` — Vercel origin, no `/api` suffix
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` — Android maps
- `GOOGLE_SERVICES_JSON` — EAS file secret for FCM (+ Firebase App Check on Android)
- `GOOGLE_SERVICES_PLIST` — EAS file secret for iOS Firebase App Check (`GoogleService-Info.plist`)
- `EXPO_PUBLIC_APP_ENV` — e.g. `production`

Also useful: `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`.

### OTP abuse protection (App Check + rate limits)

Server (always on after deploy):

- Migration `otp_rate_limits` — ledgers/permits
- Edge `send-auth-email` — `otp_consume_send_permit` (rate limits always; permit when `OTP_REQUIRE_APP_CHECK=true`)
- Vercel `POST /api/auth/otp-gate` — App Check verify + issue permit

Vercel env:

- `FIREBASE_PROJECT_ID=harmonizer-777`
- `FIREBASE_SERVICE_ACCOUNT_JSON` — service account JSON (Firebase Admin / App Check verify)
- `OTP_APP_CHECK_DEBUG_SECRET` — shared secret for Expo/Test debug attestation
- `OTP_REQUIRE_APP_CHECK` — currently **`false`** (2026-07-30): store clients failed App Check before Play Integrity token was ready. Rate limits still apply. Set `true` only after store builds reliably send `appCheckToken` (see client retry in `modules/auth/appCheck.ts`)

Supabase edge secret: same `OTP_REQUIRE_APP_CHECK`.

EAS / `.env.local` for Expo/Test:

- `EXPO_PUBLIC_OTP_APP_CHECK_DEBUG_SECRET` = same value as `OTP_APP_CHECK_DEBUG_SECRET`

Firebase Console checklist:

1. App Check → register Android (`com.zamkovoi.harmonizer`) Play Integrity + iOS App Attest
2. Register debug tokens for Expo/Test devices (or use debug secret above)
3. iOS Firebase client file (required for App Check in the IPA):
   - Firebase Console → iOS app `com.zamkovoi.harmonizer.app` → download `GoogleService-Info.plist`
   - Copy to repo root (gitignored; included in EAS archive via `.easignore`)
   - Upload file-env: `eas env:create --name GOOGLE_SERVICES_PLIST --type file --value ./GoogleService-Info.plist --environment production` (also preview/development as needed)
   - Without it, `app.config.ts` skips Firebase config plugins and `react-native.config.js` disables iOS autolink so `pod install` does not pull AppCheckCore; App Check on device stays off
   - If you *do* have the plist and CocoaPods still fails on `AppCheckCore`, run: `node scripts/refresh-cocoapods-appcheck-cdn.mjs` (stale CDN etag can hide 11.3.x; iOS local build scripts + Podfile preamble plugin do this automatically)

Turnstile / invisible captcha: **not** used (RN WebView UX risk).

Legacy Google Sign-In client ids may still sit in **development** EAS env; OTP-only auth does not require them in production.

### Rebuild after env changes

Changing EAS env does **not** patch an already-uploaded AAB/IPA. Rebuild + resubmit.

### Local builds + submit (fixed paths, no copy-paste)

Artifacts always land in gitignored `dist/` (same filename every time). After build, submit needs **no** path typing.

```bash
source ~/.zshrc   # JAVA_HOME / ANDROID_HOME

# Android production → dist/harmonizer-production.aab → Play
npm run build:android:prod
npm run submit:android

# iOS production → dist/harmonizer-production.ipa → TestFlight
npm run build:ios:prod
npm run submit:ios

# Development clients (install on device; no store submit)
npm run build:android:dev    # → dist/harmonizer-development.apk
npm run build:ios:dev:local  # → dist/harmonizer-development.ipa
```

Prereqs: Android SDK + JDK 17 in `~/.zshrc`; Xcode + CocoaPods + Fastlane for iOS.  
`EXPO_NO_CAPABILITY_SYNC=1` is baked into the iOS npm scripts.  
`ascAppId` is in `eas.json` → `submit.production.ios`.  
Do **not** rely on `eas submit --latest` after `--local` (cloud-oriented); use the fixed `--output` paths above.

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

