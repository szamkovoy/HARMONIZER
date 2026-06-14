-- Pre-generated translations for global_daily_content (free-tier LLM texts).
-- Canonical RU stays in slogan / short_text / long_explanation; other locales in text_i18n.

alter table public.global_daily_content
  add column if not exists text_i18n jsonb not null default '{}'::jsonb;

comment on column public.global_daily_content.text_i18n is
  'Map locale code -> { slogan, short_text, long_explanation }. Filled by precompute-global-recommendations / ensureGlobalDailyContentRow.';
