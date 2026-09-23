-- First Harmonizer entry starts a 24h demo.
-- A GetCourse/mailing row is not a Harmonizer account: trial stays null until
-- the person actually signs in (OTP). People who already opened the app are
-- stamped and are not granted a demo retroactively.
-- An active paid plan replaces a running demo.

alter table public.users
  add column if not exists app_first_open_at timestamptz;

comment on column public.users.app_first_open_at is
  'First real Harmonizer sign-in. Null = mailing/import row that has never entered the app. Once set, the one-day demo is not started again.';

comment on column public.users.trial_expires_at is
  'When the one-day demo ends. Set on the first Harmonizer sign-in if the person has never used the app and has no active paid plan. An active paid plan clears it.';

-- Already inside the app: remember that, do not start a demo.
update public.users
set app_first_open_at = coalesce(onboarded_at, last_seen_at)
where app_first_open_at is null
  and (onboarded_at is not null or last_seen_at is not null);

create or replace function public.user_has_active_paid_plan(p_tier text, p_expires timestamptz)
returns boolean
language sql
stable
as $$
  select lower(btrim(coalesce(p_tier, ''))) in ('oracle', 'practitioner', 'master', 'premium')
     and (p_expires is null or p_expires > now());
$$;

revoke all on function public.user_has_active_paid_plan(text, timestamptz) from public;
revoke all on function public.user_has_active_paid_plan(text, timestamptz) from anon;
revoke all on function public.user_has_active_paid_plan(text, timestamptz) from authenticated;

-- Called from the auth sign-in trigger. Idempotent: a second call does nothing.
create or replace function public.grant_harmonizer_trial_if_first_entry(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('harmonizer.trial_write', 'server', true);

  update public.users u
  set
    app_first_open_at = now(),
    trial_expires_at = case
      when u.trial_expires_at is null
        and coalesce(u.store_review_account, false) = false
        and not public.user_has_active_paid_plan(u.membership_tier, u.membership_expires_at)
      then now() + interval '1 day'
      else u.trial_expires_at
    end
  where u.id = p_user_id
    and u.app_first_open_at is null
    and u.onboarded_at is null
    and u.last_seen_at is null;

  perform set_config('harmonizer.trial_write', '', true);
end;
$$;

revoke all on function public.grant_harmonizer_trial_if_first_entry(uuid) from public;
revoke all on function public.grant_harmonizer_trial_if_first_entry(uuid) from anon;
revoke all on function public.grant_harmonizer_trial_if_first_entry(uuid) from authenticated;
grant execute on function public.grant_harmonizer_trial_if_first_entry(uuid) to supabase_auth_admin;

create or replace function public.start_trial_on_first_sign_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.last_sign_in_at is not null or new.last_sign_in_at is null then
    return new;
  end if;

  perform public.grant_harmonizer_trial_if_first_entry(new.id);
  return new;
end;
$$;

revoke all on function public.start_trial_on_first_sign_in() from public;
revoke all on function public.start_trial_on_first_sign_in() from anon;
revoke all on function public.start_trial_on_first_sign_in() from authenticated;
grant execute on function public.start_trial_on_first_sign_in() to supabase_auth_admin;

drop trigger if exists on_auth_user_first_sign_in on auth.users;
create trigger on_auth_user_first_sign_in
  after update of last_sign_in_at on auth.users
  for each row
  execute function public.start_trial_on_first_sign_in();

-- Client cannot invent a demo. First app open (last_seen) is a backup if
-- sign-in did not grant. A running demo is replaced by an active paid plan
-- and is not wiped by a mailing-import patch.
create or replace function public.users_guard_harmonizer_trial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(auth.role(), '');
  v_server boolean := coalesce(current_setting('harmonizer.trial_write', true), '') = 'server';
begin
  if v_role = 'authenticated' and not v_server then
    new.trial_expires_at := old.trial_expires_at;
    new.app_first_open_at := old.app_first_open_at;
  end if;

  if old.app_first_open_at is null
     and old.onboarded_at is null
     and old.last_seen_at is null
     and new.last_seen_at is not null
     and new.trial_expires_at is null
     and coalesce(old.store_review_account, false) = false
     and not public.user_has_active_paid_plan(new.membership_tier, new.membership_expires_at)
  then
    new.app_first_open_at := now();
    new.trial_expires_at := now() + interval '1 day';
  elsif old.app_first_open_at is null
     and old.onboarded_at is null
     and old.last_seen_at is null
     and new.last_seen_at is not null
  then
    new.app_first_open_at := coalesce(new.app_first_open_at, now());
  end if;

  -- Import patch nulls presence and trial. A demo that already started stays.
  if old.app_first_open_at is not null
     and old.trial_expires_at is not null
     and old.trial_expires_at > now()
     and new.trial_expires_at is null
     and new.last_seen_at is null
     and new.onboarded_at is null
     and not public.user_has_active_paid_plan(new.membership_tier, new.membership_expires_at)
  then
    new.trial_expires_at := old.trial_expires_at;
    new.last_seen_at := old.last_seen_at;
    new.onboarded_at := old.onboarded_at;
    new.app_first_open_at := old.app_first_open_at;
  end if;

  if public.user_has_active_paid_plan(new.membership_tier, new.membership_expires_at)
     and new.trial_expires_at is not null
     and new.trial_expires_at > now()
  then
    new.trial_expires_at := null;
  end if;

  return new;
end;
$$;

revoke all on function public.users_guard_harmonizer_trial() from public;
revoke all on function public.users_guard_harmonizer_trial() from anon;
revoke all on function public.users_guard_harmonizer_trial() from authenticated;

drop trigger if exists users_guard_harmonizer_trial on public.users;
create trigger users_guard_harmonizer_trial
  before update on public.users
  for each row
  execute function public.users_guard_harmonizer_trial();
