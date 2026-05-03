-- Keep imported Vimeo embed metadata aligned with the Remote Play contract.
update public.practices
set params = jsonb_set(
  params,
  '{vimeo_embed,audiotrack_by_locale,ru}',
  '"ru"'::jsonb,
  true
)
where kind = 'yoga'
  and video_provider = 'vimeo'
  and params #>> '{vimeo_embed,audiotrack_by_locale,ru}' = 'en';
