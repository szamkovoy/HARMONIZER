-- Run after 20261116120000 in an isolated database. All fixtures roll back.
begin;
do $$
declare
  v_user uuid := '16161616-0000-4000-8000-000000000001';
  v_contract text := 'renewal-safety-fixture';
  v_end timestamptz := now() + interval '10 days';
  v_next timestamptz := now() + interval '40 days';
  v_result jsonb;
begin
  -- Reuse a user only for the FK; every mutation is rolled back below.
  select id into v_user from public.users limit 1;
  if v_user is null then raise exception 'Fixture requires a user'; end if;
  update public.users set membership_tier = 'oracle', membership_expires_at = v_end where id = v_user;
  insert into public.payment_contracts(contract_id, user_id, tier, currency, provider, product_kind,
    status, current_period_end, periodicity, payment_method_id)
    values(v_contract, v_user, 'oracle', 'RUB', 'yookassa', 'subscription', 'active', v_end, 'MONTHLY', null);

  perform public.apply_subscription_renewal(v_contract, v_next);
  perform public.apply_subscription_renewal(v_contract, v_next);
  perform public.apply_subscription_renewal(v_contract, v_end); -- old notification
  if (select current_period_end <> v_next from public.payment_contracts where contract_id = v_contract) then
    raise exception 'Duplicate or old renewal changed the paid period'; end if;
  if (select membership_expires_at <> v_next + interval '48 hours' from public.users where id = v_user) then
    raise exception 'Membership not granted'; end if;

  update public.payment_contracts set status = 'cancelled', cancelled_at = now() where contract_id = v_contract;
  perform public.apply_subscription_renewal(v_contract, v_next + interval '30 days');
  if (select status <> 'cancelled' or cancelled_at is null from public.payment_contracts where contract_id = v_contract) then
    raise exception 'Renewal resurrected cancellation'; end if;

  update public.users set membership_tier = 'master', membership_expires_at = now() + interval '100 days' where id = v_user;
  perform public.apply_subscription_renewal(v_contract, v_next);
  if (select membership_tier <> 'master' from public.users where id = v_user) then
    raise exception 'Higher paid access overwritten'; end if;
  update public.users set membership_tier = 'oracle', membership_expires_at = null where id = v_user;
  perform public.apply_subscription_renewal(v_contract, v_next);
  if (select membership_expires_at is not null from public.users where id = v_user) then
    raise exception 'Unlimited grant shortened'; end if;
  update public.users set membership_tier = 'oracle', membership_expires_at = now() + interval '100 days' where id = v_user;
  perform public.apply_subscription_renewal(v_contract, v_next);
  if (select membership_expires_at < now() + interval '100 days' from public.users where id = v_user) then
    raise exception 'Longer same-tier access shortened'; end if;

  update public.payment_contracts set status = 'active', cancelled_at = null, current_period_end = v_end where contract_id = v_contract;
  v_result := public.record_yookassa_renewal_failure(v_contract, 'failure-1', v_end, 'insufficient_funds');
  v_result := public.record_yookassa_renewal_failure(v_contract, 'failure-1', v_end, 'insufficient_funds');
  if (v_result->>'failCount')::integer <> 1 or (v_result->>'cancelled')::boolean then
    raise exception 'Duplicate failure counted twice'; end if;
  v_result := public.record_yookassa_renewal_failure(v_contract, 'failure-2', v_end, 'insufficient_funds');
  if not (v_result->>'cancelled')::boolean then raise exception 'Second real failure not cancelled'; end if;

  update public.payment_contracts set status = 'active', cancelled_at = null, renew_fail_count = 0, current_period_end = v_next where contract_id = v_contract;
  v_result := public.record_yookassa_renewal_failure(v_contract, 'old-failure', v_end, 'insufficient_funds');
  if (v_result->>'failCount')::integer <> 0 then raise exception 'Old failure affected paid period'; end if;
end;
$$;

-- A failure of the users write must roll back the earlier contract write.
update public.users set membership_tier = 'free', membership_expires_at = null
where id = (select user_id from public.payment_contracts where contract_id = 'renewal-safety-fixture');
create function pg_temp.reject_membership_update() returns trigger language plpgsql as $$
begin raise exception 'simulated membership failure'; end;
$$;
create trigger renewal_safety_reject_update before update on public.users
for each row execute function pg_temp.reject_membership_update();
do $$
declare
  v_before timestamptz;
  v_failed boolean := false;
begin
  select current_period_end into v_before from public.payment_contracts where contract_id = 'renewal-safety-fixture';
  begin
    perform public.apply_subscription_renewal('renewal-safety-fixture', now() + interval '100 days');
  exception when others then
    if sqlerrm <> 'simulated membership failure' then raise; end if;
    v_failed := true;
  end;
  if not v_failed or (select current_period_end is distinct from v_before from public.payment_contracts where contract_id = 'renewal-safety-fixture') then
    raise exception 'Membership failure did not roll back contract'; end if;
end;
$$;
rollback;
