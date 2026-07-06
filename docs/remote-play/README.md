# Remote Play

Remote Play links the Expo app to a public TV page through Supabase `tv_sessions`.

## Supabase

Migrations:

- `supabase/migrations/20260503014500_remote_play_tv_sessions.sql` — base table.
- `supabase/migrations/20260705190000_remote_play_audiotrack.sql` — `audiotrack text` column (nullable) written by the mobile client on `playVimeo`.
- `supabase/migrations/20260705193000_remote_play_locale.sql` — `locale text` column (nullable). **Reverted** by `20260705203000_remote_play_drop_locale.sql`: the TV page now resolves its UI language from the browser, so the app no longer writes `locale` into the session. The column is dropped.
- `supabase/migrations/20260705203000_remote_play_drop_locale.sql` — drops `tv_sessions.locale`.

The table uses short-lived rows:

- `pairing_code` is a 4-character public code.
- `expires_at` defaults to 2 hours after creation.
- `status` is one of `waiting`, `playing`, `paused`, `stopped`, `closed`.
- `audiotrack` is the Vimeo audio track slug (`"ru"` / `"en"`) the mobile client chose from the active app locale (RU → `ru`, every other content locale → `en`, see `modules/practices/core/vimeo.ts` `vimeoAudiotrackForLocale`). Nullable: legacy rows and anonymous-created waiting sessions have `null`, and the TV page falls back to its `VIMEO_AUDIO_TRACK` default (`ru`). The audio track follows the **app** locale (the user's choice), not the TV browser — the browser cannot know which language the user picked in the app, so this column stays.
- TV tab close (`beforeunload`/`pagehide`) sets `status = 'stopped'` (pairing kept; `sessionStorage` restores the same row on reload in the same browser profile). `status = 'closed'` is reserved for explicit unlink / stale cleanup (`linkDevice` closes other active sessions for the user before linking a new code). Mobile Stop also sets `status = 'stopped'` (keeps `vimeo_id` for replay). Mobile **Disconnect** (`useRemotePlay().disconnect()`) does a best-effort stop and clears the local session on the phone so the UI returns to the pairing flow.

The migration adds `public.tv_sessions` to the `supabase_realtime` publication. After `supabase db push`, verify in Supabase Dashboard that Realtime is enabled for `tv_sessions` if the publication is not reflected in Studio.

## WordPress

Paste `docs/remote-play/wordpress-snippet.html` into a WordPress Custom HTML block and replace:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

The snippet creates a waiting session, shows the code, subscribes to the row, and starts Vimeo playback when Expo writes `vimeo_id`. It also polls the same row every 2 seconds as a fallback in case a browser or WordPress page loses a Realtime event. Vimeo embed URL must be exactly `https://player.vimeo.com/video/<id>?audiotrack=<slug>` (no other query params). The slug is read from the session row's `audiotrack`; when that column is `null` the snippet falls back to `VIMEO_AUDIO_TRACK` (default `ru`). A change of `audiotrack` on the same `vimeo_id` (e.g. the user switches locale and re-launches) re-mounts the player because `audiotrack` is part of the row fingerprint. Do not switch the audio language through the Vimeo Player API after mount: playback depends on the iframe `src` carrying `?audiotrack=<slug>`.

### UI language

The TV page renders all its text in the **browser's** language (`navigator.language`), not the app's selected language. The strings live in a single inline `STRINGS` table keyed by the 8 content locales (only the resource values differ — no per-language page duplication). The active locale is resolved as:

1. `navigator.language` (and `navigator.languages[0]`) mapped to one of the 8 supported locales (`ru`/`en`/`de`/`fr`/`it`/`es`/`pt`/`nl`).
2. `en` — final fallback if the browser language cannot be detected or is not one of the supported locales.

The app does **not** write a `locale` into the session row anymore (the `tv_sessions.locale` column was dropped). Both the app name (`appName`: Гармонизатор / Harmonizer / Harmonisator / Harmoniseur / Armonizzatore / Armonizador / Harmonizador / Harmoniseerder) and the feature name (`remotePlay`: Удалённый просмотр / Remote Play / Fernwiedergabe / Lecture à distance / Riproduzione remota / Reproducción remota / Reprodução remota / Weergave op afstand) are localized, so the eyebrow `${appName} ${remotePlay}` is fully in the browser's language (no Latin "Remote Play" tail on Russian). The `unavailable` message is localized too. The audio track of the video itself is a separate concern and still follows the app locale via the `audiotrack` column.

### Mobile flow

- **Connect TV** (`/connect-tv`, `ConnectTVScreen`): entering 4 characters does **not** auto-connect. The user must press **«Подключить»**. After the press, a diagnostic message appears between the code fields and the button (error, or «ТВ подключен» on success). On success the button label changes to **«Закрыть»** (closes the window like ✕) — or, if the screen was opened with practice params (`vimeoId`/`title`/`durationSec`/`audiotrack`, passed by the launcher when the user picked «Open on TV» while not connected), to **«Начать практику»**, which calls `playVimeo(vimeoId, audiotrack)` and `router.replace("/tv-remote", { title, durationSec })` — the pairing window closes, the video starts on the TV browser, and the phone opens the remote.
- **Open on TV** from a practice card (hook `useAsanaRemotePlayLauncher`, also used by the catalog's `onRemotePlay`): `vimeoId` is validated up front; if not connected → `/connect-tv` with practice params; if connected → `playVimeo(vimeoId, audiotrack)` and navigate to `/tv-remote`.
- **TV remote** (`/tv-remote`, `TVRemoteScreen`): a regular push route (`headerShown: false`) built on the same shell as `app/asana-practice.tsx` — `StackScreenLayout` + `StackScrollView` + `SurfaceCardView` + `FloatingCloseButton`. It is **not** `ModalScreenLayout`: on the test device the modal shell plus a card inside `content flex:1` failed to render any `<Text>` (structure, `View` children, and the ✕ button drew fine, but all text — even a raw `<Text>` with an explicit color — was invisible; strings and theme were verified correct via logs). The `StackScreenLayout` + `StackScrollView` shell renders text normally. Shows «ТВ-пульт · код …», the practice title, «Open https://zamkovoi.yoga/tv/ on your TV or computer», progress, a status pill (status is **localized** — `playing→запущено/playing`, `paused→пауза/paused`, `stopped→остановлено/stopped`, `waiting→ожидание/waiting`, `closed→закрыто/closed`, not the raw English value), and two control buttons + «Disconnect TV». **✕, «Stop», and «Disconnect TV»** all open the shared `PracticeStopConfirmDialog` (strings from `getCoherenceBreathStrings(locale)` — the same dialog used by phone asana/breath/meditation); «End» routes by `pendingAction`: **`stop`** (✕ / «Stop») → `remotePlay.stop()` (best-effort) + `router.back()` (video stops on TV, **pairing retained**, user returns to Catalog/Day/communicator); **`disconnect`** («Disconnect TV») → `stop` + `remotePlay.disconnect()` + `router.replace("/connect-tv", { …params })` (pairing dropped, goes to pairing screen). «Continue» → dismisses the dialog and playback resumes. A `finishing` state guards double-press and swaps `finishLabel` to `finishingButton` («Завершаем…»). **State machine**: the primary button is dynamic on `status` — `stopped` → **«Replay»** (`remotePlay.playVimeo(params.vimeoId, params.audiotrack)` + resets the elapsed timer and `recordedRef`), `paused` → «Resume», otherwise → «Pause»; «Pause»/«Resume»/«Replay» act without confirmation. `stopRemotePlayback` no longer clears `vimeo_id` (it previously did, which broke `resume()` — the TV snippet only remounts the player when `status === "playing" && next.vimeo_id`, so after a stop the remote was stuck: Pause locked, Stop a no-op, no way to replay). **Connection loss** (`session` becomes null — explicit unlink, stale cleanup, or linking a new TV code after a fresh `/tv/` tab): the screen shows a **«TV connection lost»** panel + **«Reconnect TV»** → `/connect-tv` with practice params. **Tab close** (`status → stopped`, pairing retained): the phone stays connected and shows **«Replay»** + `tvStoppedHint` + optional **«Reconnect TV»** (for a fresh browser tab with a new code); reopening `/tv/` in the same browser profile restores the same pairing code via `sessionStorage`. A `practice_sessions` row is recorded for TV viewing **only if the practice effectively finished**: `maybeRecordTvSession()` when `elapsedSec >= durationSec - 10` (`COMPLETION_TAIL_SEC`); called from `confirmFinish`, on `status → stopped` (tab close near end), and on connection loss; idempotent via `recordedRef`. Early interruption is NOT recorded.

If the iframe shows `Sorry / We're having a little trouble`, verify the exact Vimeo video ID in that practice. Vimeo returns this as `PrivacyError` when the individual video is not allowed to embed on `zamkovoi.yoga` / `zamkovoi.ru`, even if other videos from the same account work.
