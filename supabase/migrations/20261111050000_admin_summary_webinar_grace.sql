-- Admin summary: same report as 20261111040000, plus a 60-minute join grace.
-- A webinar purchase paid in the first hour after starts_at belongs to that
-- webinar (starts_at + 60 minutes >= paid_at), not the next one.
--   1. Webinar one-time purchases attach to the nearest webinar whose first
--      hour is still open (starts_at + 60 minutes >= paid_at; product_ref may
--      be null). Masters on that date include manual master grants, deduped
--      by user_id. One upcoming row.
--   2. New oracle/master and renewals count successful subscription
--      settlements, not contract created_at. Cancelled/expired stay on
--      contract state.
--   3. pay_week.other = settlements that are not webinar / oracle sub /
--      master sub / book. The five categories partition count.
--   4. Week labels are the Moscow Monday as YYYY-MM-DD text (no timestamptz
--      round-trip that JS reads as the previous Sunday).
--   5. pay_week.first_time = users whose first successful payment ever falls
--      on that week.
--   6. Automation chains expose sends + sent only. Opens/clicks are not tracked
--      (status is sent | failed | skipped).
-- No emails, names, or user_ids in the output.

create or replace function public.admin_summary_report(
  p_weeks int default 8,
  p_test_emails text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_weeks int := greatest(1, least(coalesce(p_weeks, 8), 52));
  v_now timestamptz := now();
  -- MSK = UTC+3. Monday 00:00 MSK of the current week.
  v_cur_week_monday timestamptz :=
    date_trunc('week', v_now at time zone 'Europe/Moscow') at time zone 'Europe/Moscow';
  v_since timestamptz := v_cur_week_monday - make_interval(weeks => v_weeks - 1);
  v_test_user_ids uuid[];
  v_test_count int := 0;
  v_result jsonb;
begin
  if coalesce(array_length(p_test_emails, 1), 0) > 0 then
    select coalesce(array_agg(au.id), '{}'::uuid[])
    into v_test_user_ids
    from auth.users au
    where lower(au.email) = any(
      array(select lower(trim(x)) from unnest(p_test_emails) as x where btrim(x) <> '')
    );
    v_test_count := coalesce(array_length(v_test_user_ids, 1), 0);
  end if;

  with
  -- ---------- 1. Payments by week (gateway settlements, net RUB) ----------
  pay_rows as (
    select
      s.paid_at,
      s.provider,
      s.net_amount_rub,
      s.contract_id,
      s.refunded_at,
      pc.tier,
      pc.product_kind,
      pc.product_ref,
      pc.user_id
    from public.payment_settlements s
    join public.payment_contracts pc on pc.contract_id = s.contract_id
    where s.paid_at >= v_since
      and coalesce(pc.user_id, '00000000-0000-0000-0000-000000000000'::uuid) <> all(
        coalesce(v_test_user_ids, '{}'::uuid[])
      )
  ),
  -- First successful gateway payment per user, over the whole base.
  first_pay as (
    select user_id, min(paid_at) as first_at
    from public.payment_settlements s
    where s.refunded_at is null
    group by user_id
  ),
  pay_week as (
    select
      to_char(
        date_trunc('week', pr.paid_at at time zone 'Europe/Moscow'),
        'YYYY-MM-DD'
      ) as week,
      count(*) as count,
      coalesce(sum(pr.net_amount_rub), 0)::numeric(14, 2) as sum_rub,
      count(*) filter (where pr.tier = 'webinar' and pr.product_kind = 'one_time') as webinar,
      count(*) filter (where pr.tier = 'oracle' and pr.product_kind = 'subscription') as oracle,
      count(*) filter (where pr.tier = 'master' and pr.product_kind = 'subscription') as master,
      count(*) filter (where pr.tier = 'book') as book,
      count(*) filter (where not (
        (pr.tier = 'webinar' and pr.product_kind = 'one_time')
        or (pr.tier = 'oracle' and pr.product_kind = 'subscription')
        or (pr.tier = 'master' and pr.product_kind = 'subscription')
        or pr.tier = 'book'
      )) as other,
      count(*) filter (where pr.provider ilike 'yookassa%') as yookassa,
      count(*) filter (where pr.provider ilike 'lava%') as lava,
      count(distinct pr.user_id) filter (where fp.first_at = pr.paid_at) as first_time
    from pay_rows pr
    left join first_pay fp on fp.user_id = pr.user_id
    where pr.refunded_at is null
    group by 1
  ),
  first_in_period as (
    select count(distinct pr.user_id) as n
    from pay_rows pr
    join first_pay fp on fp.user_id = pr.user_id
    where pr.refunded_at is null
      and fp.first_at >= v_since
      and fp.first_at = pr.paid_at
  ),
  refunds as (
    select count(*) as n, coalesce(sum(net_amount_rub), 0)::numeric(14, 2) as sum_rub
    from pay_rows
    where refunded_at is not null
  ),

  -- ---------- 2. Subscriptions ----------
  sub_active as (
    select
      count(*) filter (where tier = 'oracle' and status = 'active') as oracle_active,
      count(*) filter (where tier = 'master' and status = 'active') as master_active
    from public.payment_contracts
    where product_kind = 'subscription'
      and status = 'active'
      and user_id <> all(coalesce(v_test_user_ids, '{}'::uuid[]))
  ),
  grants_active as (
    select count(*) as n
    from public.payments
    where source = 'manual'
      and tier in ('oracle', 'master', 'practitioner')
      and (paid_until is null or paid_until > v_now)
      and user_id <> all(coalesce(v_test_user_ids, '{}'::uuid[]))
  ),
  -- First successful subscription settlement per user+tier (lifetime).
  sub_first as (
    select pc.user_id, pc.tier, min(s.paid_at) as first_at
    from public.payment_settlements s
    join public.payment_contracts pc on pc.contract_id = s.contract_id
    where pc.product_kind = 'subscription'
      and pc.tier in ('oracle', 'master')
      and s.refunded_at is null
      and pc.user_id <> all(coalesce(v_test_user_ids, '{}'::uuid[]))
    group by pc.user_id, pc.tier
  ),
  sub_new as (
    select
      count(*) filter (where tier = 'oracle' and first_at >= v_since) as new_oracle,
      count(*) filter (where tier = 'master' and first_at >= v_since) as new_master
    from sub_first
  ),
  sub_renewals as (
    select count(*) as renewals
    from public.payment_settlements s
    join public.payment_contracts pc on pc.contract_id = s.contract_id
    where s.paid_at >= v_since
      and s.refunded_at is null
      and pc.product_kind = 'subscription'
      and pc.user_id <> all(coalesce(v_test_user_ids, '{}'::uuid[]))
      and exists (
        select 1
        from public.payment_settlements s2
        join public.payment_contracts pc2 on pc2.contract_id = s2.contract_id
        where pc2.user_id = pc.user_id
          and pc2.tier = pc.tier
          and pc2.product_kind = 'subscription'
          and s2.refunded_at is null
          and s2.paid_at < s.paid_at
      )
  ),
  -- Contract state, unchanged: only contracts created inside the window.
  sub_contract_state as (
    select
      count(*) filter (
        where product_kind = 'subscription'
        and cancelled_at >= v_since
      ) as cancelled,
      count(*) filter (
        where product_kind = 'subscription'
        and status = 'cancelled'
        and current_period_end is not null
        and current_period_end < v_now
        and current_period_end >= v_since
      ) as expired
    from public.payment_contracts
    where created_at >= v_since
      and user_id <> all(coalesce(v_test_user_ids, '{}'::uuid[]))
  ),
  sub_months as (
    select
      case when n = 1 then '1' when n = 2 then '2' when n >= 3 then '3+' end as bucket,
      count(*) as users
    from (
      select s.user_id, pc.tier, count(*) as n
      from public.payment_settlements s
      join public.payment_contracts pc on pc.contract_id = s.contract_id
      where pc.product_kind = 'subscription'
        and s.refunded_at is null
        and pc.status = 'active'
        and s.user_id <> all(coalesce(v_test_user_ids, '{}'::uuid[]))
      group by s.user_id, pc.tier
    ) t
    group by 1
  ),

  -- ---------- 3. Webinars ----------
-- Every successful one-time webinar purchase, including product_ref null.
-- Nearest webinar whose first hour is still open at paid_at
-- (starts_at + 60 minutes >= paid_at). A payment 8 minutes after the start
-- stays on that webinar.
  webinar_buys as (
    select
      pc.contract_id,
      pc.user_id,
      pc.created_at,
      s.paid_at,
      (
        select w.id
        from public.webinars w
        where w.starts_at + interval '60 minutes' >= s.paid_at
        order by w.starts_at asc, w.id asc
        limit 1
      ) as webinar_id
    from public.payment_settlements s
    join public.payment_contracts pc on pc.contract_id = s.contract_id
    where pc.product_kind = 'one_time'
      and pc.tier = 'webinar'
      and s.refunded_at is null
      and s.paid_at <= v_now
      and coalesce(pc.user_id, '00000000-0000-0000-0000-000000000000'::uuid) <> all(
        coalesce(v_test_user_ids, '{}'::uuid[])
      )
  ),
  webinar_targets as (
    select w.id, w.title, w.starts_at
    from public.webinars w
    where w.starts_at >= v_since
      and w.starts_at <= v_now
    union all
    (
      select w.id, w.title, w.starts_at
      from public.webinars w
      where w.starts_at > v_now
      order by w.starts_at asc, w.id asc
      limit 1
    )
  ),
  webinars_in_period as (
    select
      t.id,
      t.title,
      t.starts_at,
      (select count(*) from webinar_buys b where b.webinar_id = t.id) as one_time,
      (
        select count(*) from (
          select pc.user_id
          from public.payment_contracts pc
          where pc.product_kind = 'subscription'
            and pc.tier = 'master'
            and pc.status = 'active'
            and pc.created_at <= t.starts_at
            and (pc.current_period_end is null or pc.current_period_end >= t.starts_at)
            and pc.user_id <> all(coalesce(v_test_user_ids, '{}'::uuid[]))
          union
          select p.user_id
          from public.payments p
          where p.source = 'manual'
            and p.tier = 'master'
            and p.created_at <= t.starts_at
            and (p.paid_until is null or p.paid_until >= t.starts_at)
            and p.user_id <> all(coalesce(v_test_user_ids, '{}'::uuid[]))
        ) masters
      ) as masters,
      (
        select count(*)
        from webinar_buys b
        where b.webinar_id = t.id
          and exists (
            select 1
            from webinar_buys prev
            where prev.user_id = b.user_id
              and prev.created_at < b.created_at
              and prev.webinar_id is not null
              and prev.webinar_id <> b.webinar_id
          )
      ) as repeat_buyers
    from webinar_targets t
  ),

  -- ---------- 4. Mailings (sent campaigns in period) ----------
  campaigns_in_period as (
    select
      sent_at,
      subject,
      sent_count,
      delivered_count,
      opened_count,
      clicked_count,
      unsubscribed_count,
      bounced_count,
      complained_count
    from public.email_campaigns
    where status = 'sent'
      and sent_at is not null
      and sent_at >= v_since
    order by sent_at desc
  ),
  automation_totals as (
    select
      count(*) as sends,
      count(*) filter (where status = 'sent') as sent
    from public.email_automation_sends
    where created_at >= v_since
  ),

  -- ---------- 5. App ----------
  reg_week as (
    select
      to_char(
        date_trunc('week', onboarded_at at time zone 'Europe/Moscow'),
        'YYYY-MM-DD'
      ) as week,
      count(*) as count
    from public.users
    where onboarded_at is not null
      and onboarded_at >= v_since
      and id <> all(coalesce(v_test_user_ids, '{}'::uuid[]))
    group by 1
  ),
  active_7d as (
    select count(*) as n from public.users
    where last_seen_at > v_now - interval '7 days'
      and id <> all(coalesce(v_test_user_ids, '{}'::uuid[]))
  ),
  active_30d as (
    select count(*) as n from public.users
    where last_seen_at > v_now - interval '30 days'
      and id <> all(coalesce(v_test_user_ids, '{}'::uuid[]))
  ),
  consistent as (
    select count(*) as n from (
      select e.user_id
      from public.user_event_log e
      where e.kind = 'app_open'
        and e.occurred_at >= v_cur_week_monday - make_interval(weeks => 3)
        and e.occurred_at < v_cur_week_monday + interval '1 week'
        and e.user_id <> all(coalesce(v_test_user_ids, '{}'::uuid[]))
      group by e.user_id
      having count(distinct date_trunc('week', e.occurred_at at time zone 'Europe/Moscow')) >= 3
    ) t
  ),

  -- ---------- 6. Mailing base (HEAD-counts, test contacts excluded) ----------
  base_totals as (
    select
      count(*) as total,
      count(*) filter (where marketing_status = 'active') as active,
      count(*) filter (where marketing_status = 'unsubscribed') as unsubscribed,
      count(*) filter (where marketing_status = 'suppressed') as suppressed,
      count(*) filter (where marketing_status = 'complained') as complained,
      count(*) filter (where last_open_at > v_now - interval '90 days') as opened_90d,
      count(*) filter (where last_click_at > v_now - interval '90 days') as clicked_90d
    from public.email_contacts
    where coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid) <> all(
      coalesce(v_test_user_ids, '{}'::uuid[])
    )
  )

  select jsonb_build_object(
    'generated_at', v_now,
    'weeks', v_weeks,
    'since', v_since,
    'until', v_now,
    'test_excluded', v_test_count,
    'payments', jsonb_build_object(
      'by_week', coalesce((
        select jsonb_agg(jsonb_build_object(
          'week', week, 'count', count, 'sum_rub', sum_rub,
          'webinar', webinar, 'oracle', oracle, 'master', master, 'book', book,
          'other', other,
          'yookassa', yookassa, 'lava', lava,
          'first_time', first_time
        ) order by week)
        from pay_week
      ), '[]'::jsonb),
      'first_time_payers', (select n from first_in_period),
      'refunds', jsonb_build_object(
        'count', (select n from refunds),
        'sum_rub', (select sum_rub from refunds)
      )
    ),
    'subscriptions', jsonb_build_object(
      'active', jsonb_build_object(
        'oracle', (select oracle_active from sub_active),
        'master', (select master_active from sub_active),
        'manual_grants', (select n from grants_active)
      ),
      'period', jsonb_build_object(
        'new_oracle', (select new_oracle from sub_new),
        'new_master', (select new_master from sub_new),
        'renewals', (select renewals from sub_renewals),
        'cancelled', (select cancelled from sub_contract_state),
        'expired', (select expired from sub_contract_state)
      ),
      'months_distribution', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', bucket, 'users', users) order by bucket)
        from sub_months
      ), '[]'::jsonb)
    ),
    'webinars', coalesce((
      select jsonb_agg(jsonb_build_object(
        'starts_at', to_char(starts_at at time zone 'Europe/Moscow', 'YYYY-MM-DD HH24:MI'),
        'title', title,
        'one_time', one_time,
        'masters', masters,
        'repeat_buyers', repeat_buyers
      ) order by starts_at desc)
      from webinars_in_period
    ), '[]'::jsonb),
    'mailings', jsonb_build_object(
      'campaigns', coalesce((
        select jsonb_agg(jsonb_build_object(
          'sent_at', to_char(sent_at at time zone 'Europe/Moscow', 'YYYY-MM-DD HH24:MI'),
          'subject', subject,
          'sent', sent_count,
          'delivered', delivered_count,
          'opened', opened_count,
          'clicked', clicked_count,
          'unsubscribed', unsubscribed_count,
          'bounced', bounced_count,
          'complained', complained_count
        ))
        from campaigns_in_period
      ), '[]'::jsonb),
      'automations', (select jsonb_build_object(
        'sends', sends, 'sent', sent
      ) from automation_totals)
    ),
    'app', jsonb_build_object(
      'registrations_by_week', coalesce((
        select jsonb_agg(jsonb_build_object('week', week, 'count', count) order by week)
        from reg_week
      ), '[]'::jsonb),
      'active_7d', (select n from active_7d),
      'active_30d', (select n from active_30d),
      'consistent_4w', (select n from consistent)
    ),
    'mailing_base', (select jsonb_build_object(
      'total', total, 'active', active, 'unsubscribed', unsubscribed,
      'suppressed', suppressed, 'complained', complained,
      'opened_90d', opened_90d, 'clicked_90d', clicked_90d
    ) from base_totals)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_summary_report(int, text[]) from public, anon, authenticated;
grant execute on function public.admin_summary_report(int, text[]) to postgres, service_role;
