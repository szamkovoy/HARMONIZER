-- ============================================================================
-- Remote Play: per-session app locale (drives the TV page UI language)
-- ----------------------------------------------------------------------------
-- The mobile client writes the active app locale here when it links to a TV
-- session, so the WordPress TV page can render its status text in the same
-- language the user selected in the app (RU/EN/DE/FR/IT/ES/PT/NL). Nullable:
-- the TV page is opened independently and pairs via a code, so before the app
-- links the row has no locale — the page then falls back to a browser-language
-- detection (default ru). Kept separate from `audiotrack` (the Vimeo audio
-- track slug, written on playVimeo): `locale` drives UI text, `audiotrack`
-- drives the iframe `?audiotrack=` query. No RLS change — existing policies
-- already cover the column.
-- ============================================================================

alter table public.tv_sessions
  add column if not exists locale text;

comment on column public.tv_sessions.locale is
  'Active app content locale written by the mobile client on linkDevice (ru/en/de/fr/it/es/pt/nl); null = use the TV-page browser-language fallback.';
