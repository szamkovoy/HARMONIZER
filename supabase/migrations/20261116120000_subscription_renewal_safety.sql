-- Renewals must preserve cancellation, paid days, and higher/longer access.
-- Both the cron and webhook can deliver the same YooKassa charge.
create table public.payment_renewal_failures (
  payment_id text primary key,
  contract_id text not null references public.payment_contracts(contract_id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.payment_renewal_failures enable row level security;
revoke all on public.payment_renewal_failures from public, anon, authenticated;
grant all on public.payment_renewal_failures to service_role;

create or replace function public.apply_subscription_renewal(p_contract_id text, p_period_end timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.payment_contracts%rowtype;
  u public.users%rowtype;
  v_end timestamptz;
  v_access timestamptz;
  v_rank integer;
  v_user_rank integer;
begin
  if p_period_end is null or not isfinite(p_period_end) then
    raise exception 'Invalid renewal period end';
  end if;
  select * into c from public.payment_contracts where contract_id = p_contract_id for update;
  if not found then raise exception 'Unknown renewal contract'; end if;
  if coalesce(c.product_kind, 'subscription') <> 'subscription'
     or c.status not in ('active', 'cancelled') then return null; end if;
  select * into u from public.users where id = c.user_id for update;
  if not found then raise exception 'Missing renewal user'; end if;

  v_end := greatest(c.current_period_end, p_period_end);
  v_access := v_end + interval '48 hours';
  update public.payment_contracts
     set current_period_end = v_end, renew_fail_count = 0, updated_at = now()
   where contract_id = p_contract_id;
  -- No status/cancelled_at write: even a late successful charge cannot restart billing.
  v_rank := case c.tier when 'master' then 3 when 'practitioner' then 2 when 'oracle' then 1 else 0 end;
  v_user_rank := case u.membership_tier when 'master' then 3 when 'practitioner' then 2 when 'oracle' then 1 else 0 end;
  if v_access > now() and v_rank > 0 and (
    u.membership_expires_at <= now() or v_user_rank < v_rank
    or (v_user_rank = v_rank and u.membership_expires_at is not null and u.membership_expires_at < v_access)
  ) then
    update public.users set membership_tier = c.tier, membership_expires_at = v_access where id = c.user_id;
  end if;
  return jsonb_build_object('status', c.status, 'current_period_end', v_end);
end;
$$;

create or replace function public.record_yookassa_renewal_failure(
  p_contract_id text, p_payment_id text, p_period_key timestamptz, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.payment_contracts%rowtype;
  v_count integer;
  v_cancel boolean;
begin
  if nullif(trim(p_payment_id), '') is null then raise exception 'Missing renewal payment id'; end if;
  select * into c from public.payment_contracts where contract_id = p_contract_id for update;
  if not found then raise exception 'Unknown renewal contract'; end if;
  if c.provider <> 'yookassa' or coalesce(c.product_kind, 'subscription') <> 'subscription' then
    raise exception 'Not a YooKassa subscription';
  end if;
  if c.status <> 'active' or (p_period_key is not null and c.current_period_end > p_period_key) then
    return jsonb_build_object('cancelled', c.status = 'cancelled', 'failCount', coalesce(c.renew_fail_count, 0));
  end if;
  insert into public.payment_renewal_failures(payment_id, contract_id) values (p_payment_id, p_contract_id)
    on conflict do nothing;
  if not found then
    return jsonb_build_object('cancelled', false, 'failCount', coalesce(c.renew_fail_count, 0));
  end if;
  v_count := coalesce(c.renew_fail_count, 0) + 1;
  v_cancel := v_count >= 2 or coalesce(p_reason, '') ilike '%revoked%';
  update public.payment_contracts
     set renew_fail_count = v_count, updated_at = now(),
         failure_reason = left('renewal: ' || coalesce(p_reason, 'canceled'), 500),
         status = case when v_cancel then 'cancelled' else status end,
         cancelled_at = case when v_cancel then now() else cancelled_at end
   where contract_id = p_contract_id;
  if v_cancel then
    update public.yookassa_payment_methods set status = 'inactive', updated_at = now()
     where payment_method_id = c.payment_method_id;
  end if;
  return jsonb_build_object('cancelled', v_cancel, 'failCount', v_count);
end;
$$;

revoke all on function public.apply_subscription_renewal(text, timestamptz) from public, anon, authenticated;
revoke all on function public.record_yookassa_renewal_failure(text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.apply_subscription_renewal(text, timestamptz) to service_role;
grant execute on function public.record_yookassa_renewal_failure(text, text, timestamptz, text) to service_role;
