-- Подписка без продления больше не считается действующей.
--
-- Повод (2026-11-10): Lava прислала subscription.recurring.payment.failed
-- (status subscription-failed) без subscription.cancelled; контракт остался
-- status='active' с current_period_end в прошлом. Кабинет показывал «подписка
-- активна», checkout отвечал 409 already_active на любой тариф.
--
-- 1. restore_membership_from_ledger: active-подписка даёт доступ только до
--    current_period_end + 48 ч; дополнительно учитываются оплаченные 30 дней
--    тарифа (one_time, product_ref = pass_30d) до current_period_end.
-- 2. lapse_stale_subscriptions(): страховочная зачистка — active-подписка,
--    у которой период кончился больше 72 ч назад, переводится в cancelled.
-- 3. reconcile_expired_memberships (hourly) сначала вызывает зачистку.

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
           when c.product_kind = 'one_time' then c.current_period_end
           else c.current_period_end + interval '48 hours'
         end
    into v_ct_tier, v_ct_until
  from public.payment_contracts c
  where c.user_id = p_user_id
    and c.tier in ('oracle', 'practitioner', 'master')
    and (
      (
        coalesce(c.product_kind, 'subscription') = 'subscription'
        and (
          (
            c.status = 'active'
            and (c.current_period_end is null or c.current_period_end + interval '48 hours' > now())
          )
          or (c.status = 'cancelled' and c.current_period_end is not null and c.current_period_end > now())
        )
      )
      or (
        c.product_kind = 'one_time'
        and c.product_ref = 'pass_30d'
        and c.status = 'active'
        and c.current_period_end is not null
        and c.current_period_end > now()
      )
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

comment on function public.restore_membership_from_ledger(uuid) is
  'Sets users.membership_* from active payments, live subscription contracts (period end + 48h) and paid 30-day tier passes.';

create or replace function public.lapse_stale_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_count integer := 0;
begin
  with lapsed as (
    update public.payment_contracts c
       set status = 'cancelled',
           cancelled_at = now(),
           updated_at = now(),
           failure_reason = coalesce(c.failure_reason, 'lapsed: no renewal')
     where coalesce(c.product_kind, 'subscription') = 'subscription'
       and c.status = 'active'
       and c.current_period_end is not null
       and c.current_period_end < now() - interval '72 hours'
    returning c.user_id, c.provider
  ),
  methods as (
    update public.yookassa_payment_methods m
       set status = 'inactive', updated_at = now()
      from lapsed l
     where l.provider = 'yookassa'
       and m.user_id = l.user_id
       and m.status in ('active', 'pending')
    returning 1
  )
  select count(*) into v_count from lapsed;
  return v_count;
end;
$function$;

comment on function public.lapse_stale_subscriptions() is
  'Safety net: active subscription contracts whose period ended more than 72h ago become cancelled (failure_reason = lapsed: no renewal).';

revoke all on function public.lapse_stale_subscriptions() from public, anon, authenticated;
grant execute on function public.lapse_stale_subscriptions() to postgres, service_role;

create or replace function public.reconcile_expired_memberships(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  r record;
  v_count integer := 0;
begin
  perform public.lapse_stale_subscriptions();

  for r in
    select u.id
    from public.users u
    where u.membership_tier in ('oracle', 'practitioner', 'master')
      and u.membership_expires_at is not null
      and u.membership_expires_at <= now()
    order by u.membership_expires_at asc
    limit greatest(coalesce(p_limit, 100), 1)
  loop
    perform public.restore_membership_from_ledger(r.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;
