-- Этап 7 админ-панели: агрегирующая RPC для дашборда метрик.
-- Security definer, execute отозван у anon/authenticated — вызывается только
-- сервис-ролью из /api/admin/metrics. Все агрегаты считаются в БД, чтобы не
-- гонять user_event_log по сети.

-- Срез LLM-метрик за произвольное окно. Используется только из
-- admin_dashboard_metrics, но вынесен отдельно для читаемости.
create or replace function public.admin_llm_metrics(p_window interval)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'dialog_turns', count(*) filter (where kind = 'dialog_turn'),
    'avg_latency_ms', round(avg(
      case when kind = 'dialog_turn' then nullif(payload->>'latency_ms', '')::numeric end)),
    'p95_latency_ms', round((percentile_cont(0.95) within group (
      order by case when kind = 'dialog_turn' then nullif(payload->>'latency_ms', '')::numeric end))::numeric),
    'llm_errors', count(*) filter (where kind = 'llm_error'),
    'llm_timeouts', count(*) filter (where kind = 'llm_timeout'),
    'api_errors', count(*) filter (where kind = 'api_error'),
    'prompt_events', count(*) filter (where kind = 'llm_prompt_size'),
    'prompt_tokens', (
      select coalesce(sum(v.value::numeric), 0)
      from public.user_event_log e, jsonb_each_text(e.payload) v
      where e.kind = 'llm_prompt_size'
        and e.occurred_at > now() - p_window
        and v.key like '%\_tokens'
        and v.value ~ '^[0-9]+(\.[0-9]+)?$'
    )
  )
  from public.user_event_log
  where occurred_at > now() - p_window
    and kind in ('dialog_turn', 'llm_error', 'llm_timeout', 'llm_prompt_size', 'api_error');
$$;

create or replace function public.admin_dashboard_metrics()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
select jsonb_build_object(
  'generated_at', now(),
  'users', jsonb_build_object(
    'total', (select count(*) from public.users),
    'onboarded', (select count(*) from public.users where onboarded_at is not null),
    'by_tier', coalesce(
      (select jsonb_object_agg(membership_tier, cnt)
       from (select membership_tier, count(*) as cnt from public.users group by 1) t),
      '{}'::jsonb),
    'registered_7d', (select count(*) from public.users where created_at > now() - interval '7 days'),
    'registered_30d', (select count(*) from public.users where created_at > now() - interval '30 days')
  ),
  'activity', jsonb_build_object(
    'dau', (select count(distinct user_id) from public.user_event_log where occurred_at > now() - interval '1 day'),
    'wau', (select count(distinct user_id) from public.user_event_log where occurred_at > now() - interval '7 days'),
    'mau', (select count(distinct user_id) from public.user_event_log where occurred_at > now() - interval '30 days'),
    'app_opens_7d', (select count(*) from public.user_event_log where kind = 'app_open' and occurred_at > now() - interval '7 days')
  ),
  'payments', jsonb_build_object(
    'count_30d', (select count(*) from public.payments where created_at > now() - interval '30 days'),
    'sum_30d', (select coalesce(sum(amount), 0) from public.payments where created_at > now() - interval '30 days'),
    'count_total', (select count(*) from public.payments),
    'sum_total', (select coalesce(sum(amount), 0) from public.payments)
  ),
  'llm_7d', public.admin_llm_metrics(interval '7 days'),
  'llm_30d', public.admin_llm_metrics(interval '30 days')
);
$$;

revoke execute on function public.admin_llm_metrics(interval) from public;
revoke execute on function public.admin_llm_metrics(interval) from anon;
revoke execute on function public.admin_llm_metrics(interval) from authenticated;
revoke execute on function public.admin_dashboard_metrics() from public;
revoke execute on function public.admin_dashboard_metrics() from anon;
revoke execute on function public.admin_dashboard_metrics() from authenticated;
