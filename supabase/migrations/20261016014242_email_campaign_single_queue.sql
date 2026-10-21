-- Day-by-day warmup slices were only for the first mailing.
-- New campaigns and unsent drafts use one continuous queue.

alter table public.email_campaigns
  alter column warmup_plan set default jsonb_build_object(
    'sizes', jsonb_build_array(1000000),
    'repeat_last', true,
    'hour_msk', 16
  );

comment on column public.email_campaigns.warmup_plan is
  'sizes[] is one continuous queue (default 1000000, larger than the list). repeat_last and hour_msk remain for a stored plan that still pauses between waves.';

update public.email_campaigns
set
  warmup_plan = jsonb_build_object(
    'sizes', jsonb_build_array(1000000),
    'repeat_last', true,
    'hour_msk', 16
  ),
  next_wave_at = null,
  next_wave_size = null,
  updated_at = now()
where status = 'draft'
  and sent_count = 0
  and warmup_plan -> 'sizes' = jsonb_build_array(500, 500, 1000, 1000, 2000, 2000, 3000);
