-- OTP abuse protection: send rate limits, single-use send permits (App Check gate),
-- and failed-verify caps. Service-role for permit issue/consume; anon for verify helpers.

create table if not exists public.otp_send_events (
  id bigserial primary key,
  email text not null,
  created_at timestamptz not null default now()
);

create index if not exists otp_send_events_email_created_idx
  on public.otp_send_events (email, created_at desc);

create table if not exists public.otp_verify_failures (
  id bigserial primary key,
  email text not null,
  created_at timestamptz not null default now()
);

create index if not exists otp_verify_failures_email_created_idx
  on public.otp_verify_failures (email, created_at desc);

create table if not exists public.otp_send_permits (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  app_id text null
);

create index if not exists otp_send_permits_email_open_idx
  on public.otp_send_permits (email, expires_at desc)
  where consumed_at is null;

alter table public.otp_send_events enable row level security;
alter table public.otp_verify_failures enable row level security;
alter table public.otp_send_permits enable row level security;

create or replace function public._otp_normalize_email(p_email text)
returns text
language sql
immutable
as $$
  select lower(btrim(p_email));
$$;

create or replace function public._otp_email_ok(p_email text)
returns boolean
language sql
immutable
as $$
  select p_email is not null
    and p_email <> ''
    and p_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
$$;

-- Returns jsonb: { ok, code, retry_after_seconds? }
-- codes: ok | invalid_email | cooldown | hourly_limit | daily_limit
create or replace function public.otp_check_send_limits(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public._otp_normalize_email(p_email);
  v_last timestamptz;
  v_hour int;
  v_day int;
  v_retry int;
begin
  if not public._otp_email_ok(v_email) then
    return jsonb_build_object('ok', false, 'code', 'invalid_email');
  end if;

  select max(created_at) into v_last
  from public.otp_send_events
  where email = v_email;

  if v_last is not null and v_last > now() - interval '60 seconds' then
    v_retry := greatest(1, ceil(extract(epoch from (v_last + interval '60 seconds' - now())))::int);
    return jsonb_build_object(
      'ok', false,
      'code', 'cooldown',
      'retry_after_seconds', v_retry
    );
  end if;

  select count(*)::int into v_hour
  from public.otp_send_events
  where email = v_email
    and created_at > now() - interval '1 hour';

  if v_hour >= 10 then
    return jsonb_build_object(
      'ok', false,
      'code', 'hourly_limit',
      'retry_after_seconds', 3600
    );
  end if;

  select count(*)::int into v_day
  from public.otp_send_events
  where email = v_email
    and created_at > now() - interval '24 hours';

  if v_day >= 25 then
    return jsonb_build_object(
      'ok', false,
      'code', 'daily_limit',
      'retry_after_seconds', 86400
    );
  end if;

  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

revoke all on function public.otp_check_send_limits(text) from public;
grant execute on function public.otp_check_send_limits(text) to service_role;

-- Issue single-use permit after App Check (gate API, service_role only).
create or replace function public.otp_issue_send_permit(
  p_email text,
  p_app_id text default null,
  p_ttl_seconds int default 180
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public._otp_normalize_email(p_email);
  v_limits jsonb;
  v_id uuid;
  v_ttl int := greatest(30, least(coalesce(p_ttl_seconds, 180), 600));
begin
  v_limits := public.otp_check_send_limits(v_email);
  if coalesce((v_limits->>'ok')::boolean, false) is not true then
    return v_limits;
  end if;

  -- One open permit per email: replace stale opens.
  update public.otp_send_permits
  set consumed_at = now()
  where email = v_email
    and consumed_at is null;

  insert into public.otp_send_permits (email, expires_at, app_id)
  values (v_email, now() + make_interval(secs => v_ttl), nullif(btrim(p_app_id), ''))
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'permit_id', v_id,
    'expires_in_seconds', v_ttl
  );
end;
$$;

revoke all on function public.otp_issue_send_permit(text, text, int) from public;
grant execute on function public.otp_issue_send_permit(text, text, int) to service_role;

-- Consume permit + record send (send-auth-email edge, service_role).
-- When p_require_permit = false, only rate limits apply (stage A / emergency).
create or replace function public.otp_consume_send_permit(
  p_email text,
  p_require_permit boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public._otp_normalize_email(p_email);
  v_limits jsonb;
  v_permit_id uuid;
begin
  if not public._otp_email_ok(v_email) then
    return jsonb_build_object('ok', false, 'code', 'invalid_email');
  end if;

  v_limits := public.otp_check_send_limits(v_email);
  if coalesce((v_limits->>'ok')::boolean, false) is not true then
    return v_limits;
  end if;

  if p_require_permit then
    select id into v_permit_id
    from public.otp_send_permits
    where email = v_email
      and consumed_at is null
      and expires_at > now()
    order by created_at desc
    limit 1
    for update skip locked;

    if v_permit_id is null then
      return jsonb_build_object('ok', false, 'code', 'no_permit');
    end if;

    update public.otp_send_permits
    set consumed_at = now()
    where id = v_permit_id;
  end if;

  insert into public.otp_send_events (email) values (v_email);

  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

revoke all on function public.otp_consume_send_permit(text, boolean) from public;
grant execute on function public.otp_consume_send_permit(text, boolean) to service_role;

-- Failed OTP verify cap (10 / hour). Only if a send happened in the last hour.
create or replace function public.otp_check_verify_allowed(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public._otp_normalize_email(p_email);
  v_fails int;
  v_recent_send boolean;
begin
  if not public._otp_email_ok(v_email) then
    return jsonb_build_object('ok', false, 'code', 'invalid_email');
  end if;

  select exists (
    select 1 from public.otp_send_events
    where email = v_email
      and created_at > now() - interval '1 hour'
  ) into v_recent_send;

  if not v_recent_send then
    -- No recent send: allow verify (stale code path) without locking out.
    return jsonb_build_object('ok', true, 'code', 'ok');
  end if;

  select count(*)::int into v_fails
  from public.otp_verify_failures
  where email = v_email
    and created_at > now() - interval '1 hour';

  if v_fails >= 10 then
    return jsonb_build_object(
      'ok', false,
      'code', 'verify_limit',
      'retry_after_seconds', 3600
    );
  end if;

  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

revoke all on function public.otp_check_verify_allowed(text) from public;
grant execute on function public.otp_check_verify_allowed(text) to anon, authenticated, service_role;

create or replace function public.otp_record_verify_failure(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public._otp_normalize_email(p_email);
  v_check jsonb;
begin
  v_check := public.otp_check_verify_allowed(v_email);
  if coalesce((v_check->>'ok')::boolean, false) is not true
     and (v_check->>'code') = 'verify_limit' then
    return v_check;
  end if;

  if not public._otp_email_ok(v_email) then
    return jsonb_build_object('ok', false, 'code', 'invalid_email');
  end if;

  -- Only count failures when a code was recently sent (anti lock-out spam).
  if exists (
    select 1 from public.otp_send_events
    where email = v_email
      and created_at > now() - interval '1 hour'
  ) then
    insert into public.otp_verify_failures (email) values (v_email);
  end if;

  return public.otp_check_verify_allowed(v_email);
end;
$$;

revoke all on function public.otp_record_verify_failure(text) from public;
grant execute on function public.otp_record_verify_failure(text) to anon, authenticated, service_role;

comment on table public.otp_send_events is
  'Ledger of OTP emails actually sent (after rate-limit + optional App Check permit).';
comment on table public.otp_send_permits is
  'Short-lived single-use permits issued by otp-gate after App Check verification.';
comment on table public.otp_verify_failures is
  'Failed OTP code entry attempts (capped per email/hour).';
