-- Temporary demo / Master window for a campaign wave.
-- Trial rows expire on their own. Master rows are restored from the snapshot.

create table if not exists public.email_campaign_access_grants (
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('trial', 'master')),
  previous_tier text,
  previous_expires_at timestamptz,
  previous_trial_expires_at timestamptz,
  revert_at timestamptz not null,
  reverted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

create index if not exists email_campaign_access_grants_revert_idx
  on public.email_campaign_access_grants (revert_at)
  where kind = 'master' and reverted_at is null;

alter table public.email_campaign_access_grants enable row level security;

revoke all on table public.email_campaign_access_grants from public, anon, authenticated;
grant select, insert, update, delete on table public.email_campaign_access_grants to service_role;

create or replace function public.invoke_run_email_campaigns()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://harmonizer-ten.vercel.app/api/cron/email-campaigns';
  v_id bigint;
  v_due boolean;
begin
  select exists (
    select 1
    from public.email_campaigns c
    where c.send_halted_at is null
      and (c.send_lease_until is null or c.send_lease_until < now())
      and (
        c.status = 'sending'
        or (
          c.status = 'paused'
          and c.next_wave_at is not null
          and c.next_wave_at <= now()
        )
      )
  ) or exists (
    select 1
    from public.email_campaign_access_grants g
    where g.kind = 'master'
      and g.reverted_at is null
      and g.revert_at <= now()
  ) into v_due;
  if not v_due then
    return null;
  end if;

  v_secret := public._cron_secret('precompute_global_cron_secret');
  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping email-campaigns invoke';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  )
    into v_id;

  return v_id;
end;
$function$;

revoke all on function public.invoke_run_email_campaigns() from public, anon, authenticated;
grant execute on function public.invoke_run_email_campaigns() to postgres, service_role;
