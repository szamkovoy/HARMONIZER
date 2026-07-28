-- При повторной регистрации с тем же email платёжный леджер (user_id IS NULL +
-- buyer_email) снова привязывается к новому users.id. Подписки при удалении
-- аккаунта отменяются отдельно (cancelActiveSubscriptionsForUser); здесь только
-- reattach + восстановление membership из ещё действующих грантов/контрактов.
--
-- Не отменяет orphan-подписки у шлюза (ручной кейс / прошлые wipe без cancel).

create index if not exists idx_payment_contracts_buyer_email_orphan
  on public.payment_contracts (lower(buyer_email))
  where user_id is null and buyer_email is not null;

create index if not exists idx_payments_buyer_email_orphan
  on public.payments (lower(buyer_email))
  where user_id is null and buyer_email is not null;

-- Восстанавливает users.membership_* из payments + payment_contracts (подписки).
-- Контракты: active ИЛИ cancelled с current_period_end > now() (оплаченный период).
-- Grace 48ч — как в fulfillPaymentContract (RENEWAL_GRACE_MS).
create or replace function public.restore_membership_from_ledger(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tier text;
  v_expires timestamptz;
  v_pay_tier text;
  v_pay_until timestamptz;
  v_ct_tier text;
  v_ct_until timestamptz;
  v_pay_rank int;
  v_ct_rank int;
begin
  select p.tier, p.paid_until
    into v_pay_tier, v_pay_until
  from public.payments p
  where p.user_id = p_user_id
    and p.tier in ('oracle', 'practitioner', 'master')
    and (p.paid_until is null or p.paid_until > now())
  order by
    case p.tier
      when 'master' then 3
      when 'practitioner' then 2
      when 'oracle' then 1
      else 0
    end desc,
    p.paid_until desc nulls first,
    p.created_at desc
  limit 1;

  select c.tier,
         case
           when c.current_period_end is null then null
           else c.current_period_end + interval '48 hours'
         end
    into v_ct_tier, v_ct_until
  from public.payment_contracts c
  where c.user_id = p_user_id
    and c.tier in ('oracle', 'practitioner', 'master')
    and coalesce(c.product_kind, 'subscription') = 'subscription'
    and (
      c.status = 'active'
      or (c.status = 'cancelled' and c.current_period_end is not null and c.current_period_end > now())
    )
  order by
    case c.tier
      when 'master' then 3
      when 'practitioner' then 2
      when 'oracle' then 1
      else 0
    end desc,
    c.current_period_end desc nulls first,
    c.created_at desc
  limit 1;

  v_pay_rank := case v_pay_tier
    when 'master' then 3
    when 'practitioner' then 2
    when 'oracle' then 1
    else 0
  end;
  v_ct_rank := case v_ct_tier
    when 'master' then 3
    when 'practitioner' then 2
    when 'oracle' then 1
    else 0
  end;

  if v_ct_rank > v_pay_rank then
    v_tier := v_ct_tier;
    v_expires := v_ct_until;
  elsif v_pay_rank > v_ct_rank then
    v_tier := v_pay_tier;
    v_expires := v_pay_until;
  elsif v_pay_tier is not null then
    -- равный тариф: более поздний expires (null = бессрочно)
    if v_pay_until is null then
      v_tier := v_pay_tier;
      v_expires := null;
    elsif v_ct_until is null then
      v_tier := v_ct_tier;
      v_expires := null;
    elsif v_ct_until > v_pay_until then
      v_tier := v_ct_tier;
      v_expires := v_ct_until;
    else
      v_tier := v_pay_tier;
      v_expires := v_pay_until;
    end if;
  else
    v_tier := null;
    v_expires := null;
  end if;

  if v_tier is null then
    -- Не затираем trial: только paid membership сбрасываем в free.
    update public.users
    set membership_tier = 'free',
        membership_expires_at = null
    where id = p_user_id
      and (
        membership_tier is distinct from 'free'
        or membership_expires_at is not null
      );
  else
    update public.users
    set membership_tier = v_tier,
        membership_expires_at = v_expires
    where id = p_user_id;
  end if;
end;
$function$;

revoke all on function public.restore_membership_from_ledger(uuid) from public;
grant execute on function public.restore_membership_from_ledger(uuid) to service_role;

comment on function public.restore_membership_from_ledger(uuid) is
  'Sets users.membership_* from active payments + active/cancelled-in-period subscription contracts.';

-- Привязывает orphan-строки по buyer_email и восстанавливает membership.
create or replace function public.reattach_payment_ledger_for_email(
  p_user_id uuid,
  p_email text
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_count integer := 0;
  v_n integer;
begin
  if p_user_id is null or v_email = '' then
    return 0;
  end if;

  update public.payment_contracts
  set user_id = p_user_id,
      updated_at = now()
  where user_id is null
    and buyer_email is not null
    and lower(trim(buyer_email)) = v_email;
  get diagnostics v_n = row_count;
  v_count := v_count + v_n;

  update public.payments
  set user_id = p_user_id
  where user_id is null
    and buyer_email is not null
    and lower(trim(buyer_email)) = v_email;
  get diagnostics v_n = row_count;
  v_count := v_count + v_n;

  update public.payment_settlements ps
  set user_id = p_user_id
  where ps.user_id is null
    and exists (
      select 1
      from public.payment_contracts pc
      where pc.contract_id = ps.contract_id
        and pc.user_id = p_user_id
    );
  get diagnostics v_n = row_count;
  v_count := v_count + v_n;

  if v_count > 0 then
    perform public.restore_membership_from_ledger(p_user_id);
  end if;

  return v_count;
end;
$function$;

revoke all on function public.reattach_payment_ledger_for_email(uuid, text) from public;
grant execute on function public.reattach_payment_ledger_for_email(uuid, text) to service_role;

comment on function public.reattach_payment_ledger_for_email(uuid, text) is
  'Re-links orphan payment_contracts/payments/settlements by buyer_email; restores membership.';

-- Триггер регистрации: после создания users — reattach леджера по email.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, display_name, locale, membership_tier, trial_expires_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name',
             split_part(new.email, '@', 1)),
    coalesce(nullif(new.raw_user_meta_data->>'locale', ''), 'ru'),
    'free',
    now() + interval '1 day'
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  perform public.reattach_payment_ledger_for_email(new.id, new.email);

  return new;
end;
$$;

-- Backfill для уже существующих аккаунтов (тот же email после wipe).
do $$
declare
  r record;
begin
  for r in
    select u.id, au.email
    from public.users u
    join auth.users au on au.id = u.id
    where au.email is not null
      and (
        exists (
          select 1 from public.payment_contracts pc
          where pc.user_id is null
            and pc.buyer_email is not null
            and lower(trim(pc.buyer_email)) = lower(trim(au.email))
        )
        or exists (
          select 1 from public.payments p
          where p.user_id is null
            and p.buyer_email is not null
            and lower(trim(p.buyer_email)) = lower(trim(au.email))
        )
      )
  loop
    perform public.reattach_payment_ledger_for_email(r.id, r.email);
  end loop;
end;
$$;
