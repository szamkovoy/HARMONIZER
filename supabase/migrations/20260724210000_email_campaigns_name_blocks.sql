-- Campaign display name + block editor JSON (rendered to html_* on save).

alter table public.email_campaigns
  add column if not exists name text not null default '';

alter table public.email_campaigns
  add column if not exists blocks_i18n jsonb not null default '{}'::jsonb;

comment on column public.email_campaigns.name is
  'Admin-facing campaign title (not the email subject).';
comment on column public.email_campaigns.blocks_i18n is
  'Per-locale block arrays for the visual editor; html_body(_i18n) is the rendered send payload.';
