-- ============================================================================
-- Remote Play: drop the per-session `locale` column (reverted)
-- ----------------------------------------------------------------------------
-- The TV page now resolves its UI language from the browser (navigator.language)
-- with an English fallback, so the app no longer writes `locale` into the
-- session row. The `audiotrack` column is intentionally kept — it still drives
-- the Vimeo iframe `?audiotrack=` query (video audio follows the app locale,
-- which the browser cannot know).
-- ============================================================================

alter table public.tv_sessions
  drop column if exists locale;
