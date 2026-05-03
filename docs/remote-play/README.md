# Remote Play

Remote Play links the Expo app to a public TV page through Supabase `tv_sessions`.

## Supabase

Migration: `supabase/migrations/20260503014500_remote_play_tv_sessions.sql`.

The table uses short-lived rows:

- `pairing_code` is a 4-character public code.
- `expires_at` defaults to 2 hours after creation.
- `status` is one of `waiting`, `playing`, `paused`, `stopped`, `closed`.
- TV tab close sets `status = 'closed'`; mobile Stop sets `status = 'stopped'` and clears `vimeo_id`.

The migration adds `public.tv_sessions` to the `supabase_realtime` publication. After `supabase db push`, verify in Supabase Dashboard that Realtime is enabled for `tv_sessions` if the publication is not reflected in Studio.

## WordPress

Paste `docs/remote-play/wordpress-snippet.html` into a WordPress Custom HTML block and replace:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

The snippet creates a waiting session, shows the code, subscribes to the row, and starts Vimeo playback when Expo writes `vimeo_id`. It also polls the same row every 2 seconds as a fallback in case a browser or WordPress page loses a Realtime event. Vimeo embed URL must be exactly `https://player.vimeo.com/video/<id>?audiotrack=<slug>` (no other query params); `VIMEO_AUDIO_TRACK` defaults to `ru`.
