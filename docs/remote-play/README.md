# Remote Play

Remote Play links the Expo app to a public TV page through Supabase `tv_sessions`.

## Supabase

Migrations:

- `supabase/migrations/20260503014500_remote_play_tv_sessions.sql` — base table.
- `supabase/migrations/20260705190000_remote_play_audiotrack.sql` — `audiotrack text` column (nullable) written by the mobile client on `playVimeo`.
- `supabase/migrations/20260705193000_remote_play_locale.sql` — `locale text` column (nullable) written by the mobile client on `linkDevice` (and refreshed on `playVimeo`).

The table uses short-lived rows:

- `pairing_code` is a 4-character public code.
- `expires_at` defaults to 2 hours after creation.
- `status` is one of `waiting`, `playing`, `paused`, `stopped`, `closed`.
- `audiotrack` is the Vimeo audio track slug (`"ru"` / `"en"`) the mobile client chose from the active app locale (RU → `ru`, every other content locale → `en`, see `modules/practices/core/vimeo.ts` `vimeoAudiotrackForLocale`). Nullable: legacy rows and anonymous-created waiting sessions have `null`, and the TV page falls back to its `VIMEO_AUDIO_TRACK` default (`ru`).
- `locale` is the active app content locale (`ru`/`en`/`de`/`fr`/`it`/`es`/`pt`/`nl`) the mobile client writes when it links to the session, so the TV page can render its UI text in the same language the user selected in the app. Nullable: before the app links, the TV page falls back to a `navigator.language` detection (default `ru`).
- TV tab close sets `status = 'closed'`; mobile Stop sets `status = 'stopped'` and clears `vimeo_id`.

The migration adds `public.tv_sessions` to the `supabase_realtime` publication. After `supabase db push`, verify in Supabase Dashboard that Realtime is enabled for `tv_sessions` if the publication is not reflected in Studio.

## WordPress

Paste `docs/remote-play/wordpress-snippet.html` into a WordPress Custom HTML block and replace:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

The snippet creates a waiting session, shows the code, subscribes to the row, and starts Vimeo playback when Expo writes `vimeo_id`. It also polls the same row every 2 seconds as a fallback in case a browser or WordPress page loses a Realtime event. Vimeo embed URL must be exactly `https://player.vimeo.com/video/<id>?audiotrack=<slug>` (no other query params). The slug is read from the session row's `audiotrack`; when that column is `null` the snippet falls back to `VIMEO_AUDIO_TRACK` (default `ru`). A change of `audiotrack` on the same `vimeo_id` (e.g. the user switches locale and re-launches) re-mounts the player because `audiotrack` is part of the row fingerprint. Do not switch the audio language through the Vimeo Player API after mount: playback depends on the iframe `src` carrying `?audiotrack=<slug>`.

### UI language

The TV page renders all its text in the language the user selected in the app. The strings live in a single inline `STRINGS` table keyed by the 8 content locales (only the resource values differ — no per-language page duplication). The active locale is resolved as:

1. `row.locale` (written by the mobile client on `linkDevice`/`playVimeo`) — the source of truth once the app has paired.
2. `navigator.language` detection mapped to one of the 8 locales — used before pairing (the page is opened independently on the TV and only learns the app locale after the code is entered).
3. `ru` — final fallback.

`locale` is part of the row fingerprint, so when the app links the page re-renders in the app's language immediately. The localized app name (`appName`: Гармонизатор / Harmonizer / Harmonisator / Harmoniseur / Armonizzatore / Armonizador / Harmonizador / Harmoniseerder) heads the eyebrow as `${appName} Remote Play`; "Remote Play" stays as the Latin feature brand.

If the iframe shows `Sorry / We're having a little trouble`, verify the exact Vimeo video ID in that practice. Vimeo returns this as `PrivacyError` when the individual video is not allowed to embed on `zamkovoi.yoga` / `zamkovoi.ru`, even if other videos from the same account work.
