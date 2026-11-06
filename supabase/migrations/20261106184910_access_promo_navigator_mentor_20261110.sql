-- Promo window: already-entered Navigators get demo, active Mentors get
-- temporary Master, until 2026-11-10 00:00:00 UTC (end of 9 Nov GMT).
-- payment_contracts are not written. A renewal or a real Master purchase
-- during the window is left in place at revert.

create table if not exists public.access_promo_grants (
  user_id uuid primary key references public.users(id) on delete cascade,
  kind text not null check (kind in ('master')),
  previous_tier text not null,
  previous_expires_at timestamptz,
  previous_trial_expires_at timestamptz,
  revert_at timestamptz not null,
  reverted_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.access_promo_grants is
  'Snapshot of Mentor rows temporarily shown as Master until revert_at. Trial Navigators are not stored: their trial_expires_at ends the promo by itself.';

alter table public.access_promo_grants enable row level security;

revoke all on table public.access_promo_grants from public, anon, authenticated;
grant select, insert, update, delete on table public.access_promo_grants to service_role;

create or replace function public.revert_access_promo_grants()
returns integer
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  v_now timestamptz := now();
  v_count integer := 0;
  r record;
  v_keep boolean;
begin
  if not exists (
    select 1
    from public.access_promo_grants g
    where g.kind = 'master'
      and g.reverted_at is null
      and g.revert_at <= v_now
  ) then
    return 0;
  end if;

  for r in
    select
      g.user_id,
      g.previous_tier,
      g.previous_expires_at,
      g.revert_at,
      g.created_at,
      u.membership_tier,
      u.membership_expires_at
    from public.access_promo_grants g
    join public.users u on u.id = g.user_id
    where g.kind = 'master'
      and g.reverted_at is null
      and g.revert_at <= v_now
    for update of g
  loop
    v_keep := exists (
      select 1
      from public.payment_contracts c
      where c.user_id = r.user_id
        and c.tier = 'master'
        and c.product_kind = 'subscription'
        and c.created_at > r.created_at
        and c.status in ('active', 'cancelled')
        and (c.current_period_end is null or c.current_period_end > v_now)
    ) or exists (
      select 1
      from public.payments p
      where p.user_id = r.user_id
        and p.tier = 'master'
        and p.created_at > r.created_at
        and (p.paid_until is null or p.paid_until > v_now)
    );

    if not v_keep
       and r.membership_tier = 'master'
       and r.previous_tier in ('oracle', 'practitioner')
       and (
         r.membership_expires_at is not distinct from r.previous_expires_at
         or r.membership_expires_at = r.revert_at
       )
    then
      update public.users
      set
        membership_tier = r.previous_tier,
        membership_expires_at = r.previous_expires_at
      where id = r.user_id
        and membership_tier = 'master';
    elsif not v_keep
       and r.membership_tier = 'master'
       and r.previous_tier in ('oracle', 'practitioner')
    then
      -- A payment moved the end date. Put the tier back and keep that date.
      update public.users
      set membership_tier = r.previous_tier
      where id = r.user_id
        and membership_tier = 'master';
    end if;

    update public.access_promo_grants
    set reverted_at = v_now
    where user_id = r.user_id
      and reverted_at is null;

    v_count := v_count + 1;
  end loop;

  if not exists (
    select 1
    from public.access_promo_grants
    where kind = 'master'
      and reverted_at is null
  ) then
    begin
      perform cron.unschedule(j.jobid)
      from cron.job j
      where j.jobname = 'revert_access_promo_20261110';
    exception
      when others then
        raise warning 'revert_access_promo_grants: unschedule failed: %', sqlerrm;
    end;
  end if;

  return v_count;
end;
$$;

comment on function public.revert_access_promo_grants() is
  'Restores Mentor snapshots after the 2026-11-10 00:00 UTC promo. Skips a user who bought Master during the window, or whose tier was already replaced by a renewal.';

revoke all on function public.revert_access_promo_grants() from public, anon, authenticated;
grant execute on function public.revert_access_promo_grants() to postgres, service_role;

-- Mentors first, so the Navigator trial update cannot see them as free.
insert into public.access_promo_grants (
  user_id,
  kind,
  previous_tier,
  previous_expires_at,
  previous_trial_expires_at,
  revert_at
)
select
  u.id,
  'master',
  u.membership_tier,
  u.membership_expires_at,
  u.trial_expires_at,
  timestamptz '2026-11-10 00:00:00+00'
from public.users u
where lower(btrim(coalesce(u.membership_tier, ''))) in ('oracle', 'practitioner')
  and (u.membership_expires_at is null or u.membership_expires_at > now())
  and coalesce(u.store_review_account, false) = false
on conflict (user_id) do nothing;

update public.users u
set
  membership_tier = 'master',
  membership_expires_at = case
    when u.membership_expires_at is not null
     and u.membership_expires_at < timestamptz '2026-11-10 00:00:00+00'
    then timestamptz '2026-11-10 00:00:00+00'
    else u.membership_expires_at
  end
from public.access_promo_grants g
where g.user_id = u.id
  and g.kind = 'master'
  and g.reverted_at is null
  and lower(btrim(coalesce(u.membership_tier, ''))) in ('oracle', 'practitioner');

-- Already inside the app, no live paid plan: demo until the same instant.
-- Never-opened rows stay null so the first sign-in still grants its own 24h.
update public.users u
set trial_expires_at = timestamptz '2026-11-10 00:00:00+00'
where not public.user_has_active_paid_plan(u.membership_tier, u.membership_expires_at)
  and coalesce(u.store_review_account, false) = false
  and (u.app_first_open_at is not null or u.last_seen_at is not null or u.onboarded_at is not null)
  and (u.trial_expires_at is null or u.trial_expires_at < timestamptz '2026-11-10 00:00:00+00');

select cron.schedule(
  'revert_access_promo_20261110',
  '*/15 * * * *',
  'select public.revert_access_promo_grants();'
);
