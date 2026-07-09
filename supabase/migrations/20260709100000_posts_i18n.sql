-- Add multilingual fields to posts table.
-- Each column stores a JSON object keyed by locale code (en/de/fr/it/es/pt/nl).
-- RU content lives in the original title/body/cover_url columns.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS title_i18n   jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS body_i18n    jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cover_url_i18n jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS translations_updated_at timestamptz NULL;

COMMENT ON COLUMN public.posts.title_i18n
  IS 'Translated titles keyed by locale (en/de/fr/it/es/pt/nl). RU stays in title.';
COMMENT ON COLUMN public.posts.body_i18n
  IS 'Translated bodies keyed by locale. RU stays in body.';
COMMENT ON COLUMN public.posts.cover_url_i18n
  IS 'Per-locale cover URLs. If absent for a locale, falls back to cover_url.';
COMMENT ON COLUMN public.posts.translations_updated_at
  IS 'When LLM translations were last generated; NULL = never translated.';
