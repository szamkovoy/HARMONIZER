-- Freeze in-flight drip remaining time while an automation is paused.
-- On resume, next_step_at is shifted by (resumed_at - paused_at).

alter table public.email_automations
  add column if not exists paused_at timestamptz;

update public.email_automations
set paused_at = updated_at
where is_active = false
  and paused_at is null;

create or replace function public.shift_email_automation_enrollments_after_pause(
  p_automation_id uuid,
  p_paused_at timestamptz,
  p_resumed_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_delta interval;
begin
  if p_automation_id is null or p_paused_at is null or p_resumed_at is null then
    return 0;
  end if;

  v_delta := p_resumed_at - p_paused_at;
  if v_delta < interval '0' then
    v_delta := interval '0';
  end if;
  if v_delta = interval '0' then
    return 0;
  end if;

  update public.email_automation_enrollments
  set
    next_step_at = next_step_at + v_delta,
    updated_at = p_resumed_at
  where automation_id = p_automation_id
    and status = 'active'
    and next_step_at is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.shift_email_automation_enrollments_after_pause(uuid, timestamptz, timestamptz) from public;
grant execute on function public.shift_email_automation_enrollments_after_pause(uuid, timestamptz, timestamptz) to service_role;
