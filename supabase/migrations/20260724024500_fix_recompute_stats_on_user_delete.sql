-- Account delete failed with:
--   null value in column "local_date" of relation "user_daily_stats"
-- when CASCADE removed practice_sessions and recompute_user_daily_stats
-- ran with a null timezone/date (user row already gone mid-wipe).
--
-- Also harden prompts.created_by so admin-authored prompts never block wipe.

create or replace function public.recompute_user_daily_stats()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id    uuid;
  v_started_at timestamptz;
  v_tz         text;
  v_local_date date;
begin
  if tg_op = 'DELETE' then
    v_user_id    := old.user_id;
    v_started_at := old.started_at;
  else
    v_user_id    := new.user_id;
    v_started_at := new.started_at;
  end if;

  -- Account wipe: parent users row may already be gone; stats CASCADE with it.
  if not exists (select 1 from public.users where id = v_user_id) then
    return null;
  end if;

  if v_started_at is null then
    return null;
  end if;

  select coalesce(nullif(trim(tz), ''), 'UTC') into v_tz
  from public.users
  where id = v_user_id;

  if v_tz is null then
    v_tz := 'UTC';
  end if;

  v_local_date := (v_started_at at time zone v_tz)::date;
  if v_local_date is null then
    return null;
  end if;

  insert into public.user_daily_stats (
    user_id, local_date,
    total_practice_seconds, practice_count, chakras_touched, updated_at
  )
  select
    v_user_id,
    v_local_date,
    coalesce(sum(coalesce(duration_sec, 0)), 0),
    count(*),
    coalesce(
      (select array_agg(distinct c order by c)
         from (
           select unnest(chakra_focus_ids) as c
             from public.practice_sessions
            where user_id = v_user_id
              and (started_at at time zone v_tz)::date = v_local_date
         ) s
      ),
      '{}'
    ),
    now()
  from public.practice_sessions
  where user_id = v_user_id
    and (started_at at time zone v_tz)::date = v_local_date
  on conflict (user_id, local_date)
  do update set
    total_practice_seconds = excluded.total_practice_seconds,
    practice_count         = excluded.practice_count,
    chakras_touched        = excluded.chakras_touched,
    updated_at             = now();

  return null;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'prompts_created_by_fkey'
      and conrelid = 'public.prompts'::regclass
  ) then
    alter table public.prompts drop constraint prompts_created_by_fkey;
  end if;
end $$;

alter table public.prompts
  add constraint prompts_created_by_fkey
  foreign key (created_by) references public.users(id) on delete set null;
