-- ============================================================================
-- Remote Play: per-session Vimeo audio track (locale-driven)
-- ----------------------------------------------------------------------------
-- The asana videos ship two Vimeo audio tracks — `ru` and `en`. The mobile
-- client derives the track from the active app locale (RU → ru, every other
-- content locale → en, see `modules/practices/core/vimeo.ts`
-- `vimeoAudiotrackForLocale`) and writes it here on `playVimeo`, so the TV
-- WordPress snippet can build `player.vimeo.com/video/<id>?audiotrack=<slug>`
-- without hardcoding Russian. Nullable + defaults to null: legacy rows and
-- anonymous-created waiting sessions simply have no preferred track, and the
-- TV snippet falls back to `ru` (its previous behaviour) when the column is
-- null. No RLS change — the existing policies already cover the column.
-- ============================================================================

alter table public.tv_sessions
  add column if not exists audiotrack text;

comment on column public.tv_sessions.audiotrack is
  'Vimeo audio track slug written by the mobile client on playVimeo (e.g. "ru" / "en"); null = use the TV-page default (ru).';
