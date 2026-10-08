-- Платёжные виджеты для лендингов + общий каталог продуктов + пропуск на вебинары.
--
-- 1) payment_catalog — общий каталог: строка ЮKassa (RUB) + привязанный offer Lava
--    (lava_offer_id), письмо покупателю на 8 языках, параметры пропуска на вебинары.
-- 2) payment_widgets — виджеты (конфиг формы/стиля/текстов), код вставки на сайт.
-- 3) payment_contracts — источник покупки (cabinet|widget), widget_id, catalog_id,
--    имя/язык покупателя, отметка отправки письма. Новый tier `webinar_pack`.
-- 4) webinar_passes — право записаться на N вебинаров в окне [valid_from, valid_until).
--    apply_webinar_passes() записывает владельцев пропусков на опубликованные
--    вебинары окна (pg_cron каждые 5 минут + сразу после оплаты).
-- 5) webinar_registrations.pass_id / join_email_sent_at — письмо со ссылкой на
--    трансляцию за ~час до начала (Vercel cron webinar-pass-emails).

-- ── Tier `webinar_pack` ────────────────────────────────────────────────────
alter table public.payment_catalog drop constraint if exists payment_catalog_tier_check;
alter table public.payment_catalog
  add constraint payment_catalog_tier_check
  check (tier in ('oracle', 'master', 'webinar', 'webinar_pack', 'book'));

alter table public.payment_contracts drop constraint if exists payment_contracts_tier_check;
alter table public.payment_contracts
  add constraint payment_contracts_tier_check
  check (tier in ('oracle', 'master', 'webinar', 'webinar_pack', 'book'));

-- ── Каталог ────────────────────────────────────────────────────────────────
alter table public.payment_catalog
  add column if not exists lava_offer_id text,
  add column if not exists webinar_credits integer check (webinar_credits is null or webinar_credits > 0),
  add column if not exists webinar_window_days integer check (webinar_window_days is null or webinar_window_days > 0),
  add column if not exists letter_subject_i18n jsonb not null default '{}'::jsonb,
  add column if not exists letter_body_i18n jsonb not null default '{}'::jsonb,
  add column if not exists sort_order integer not null default 100;

comment on column public.payment_catalog.lava_offer_id is
  'Lava.top offer id (not product id) sold for international cards. Takes precedence over payment_offers en fallback.';
comment on column public.payment_catalog.webinar_credits is
  'Webinar pass: how many webinars the buyer is registered for (webinar / webinar_pack bought without a fixed webinar).';
comment on column public.payment_catalog.webinar_window_days is
  'Webinar pass: window length from the payment moment; webinars starting inside it count.';
comment on column public.payment_catalog.letter_subject_i18n is
  'Letter to a widget buyer after payment: { locale: subject }.';
comment on column public.payment_catalog.letter_body_i18n is
  'Letter to a widget buyer after payment: { locale: plain text, blank line = paragraph, {{name}} placeholder }.';

update public.payment_catalog c
set lava_offer_id = po.offer_id
from public.payment_offers po
where c.provider = 'yookassa'
  and c.lava_offer_id is null
  and po.tier = c.tier
  and po.locale = 'en'
  and po.active;

update public.payment_catalog
set sort_order = case tier
  when 'oracle' then 10
  when 'master' then 20
  when 'webinar' then 30
  when 'webinar_pack' then 40
  when 'book' then 50
  else sort_order
end;

update public.payment_catalog
set amount = 1500,
    lava_offer_id = '6ddb40b1-1ec5-4ba7-844c-fd1ab66623b4',
    webinar_credits = 1,
    webinar_window_days = 7,
    letter_subject_i18n = case
      when letter_subject_i18n = '{}'::jsonb
        then jsonb_build_object('ru', 'Спасибо за оплату участия в вебинаре')
      else letter_subject_i18n
    end,
    letter_body_i18n = case
      when letter_body_i18n = '{}'::jsonb
        then jsonb_build_object('ru', E'Здравствуйте, {{name}}!\n\nСпасибо за оплату. Вы записаны на ближайший вебинар — он пройдёт в течение 7 дней с момента оплаты.\n\nПримерно за час до начала я пришлю вам письмо со ссылкой на трансляцию. Ссылка также появится в приложении «Гармонизатор», если вы войдёте в него с этим же email.\n\nДо встречи на вебинаре!\nСергей Замковой')
      else letter_body_i18n
    end,
    updated_at = now()
where provider = 'yookassa' and tier = 'webinar' and currency = 'RUB';

insert into public.payment_catalog
  (provider, tier, currency, amount, title, description, product_kind,
   lava_offer_id, webinar_credits, webinar_window_days, sort_order,
   letter_subject_i18n, letter_body_i18n)
values (
  'yookassa', 'webinar_pack', 'RUB', 4000,
  'Четыре вебинара',
  'Участие в 4 вебинарах в течение 28 дней после оплаты.',
  'one_time',
  'e7ca7616-f9bd-4d10-b88f-74705150d979', 4, 28, 40,
  jsonb_build_object('ru', 'Спасибо за оплату участия в четырёх вебинарах'),
  jsonb_build_object('ru', E'Здравствуйте, {{name}}!\n\nСпасибо за оплату. В течение 28 дней с момента оплаты вы можете участвовать в четырёх вебинарах. Я сам запишу вас на каждый из них.\n\nПримерно за час до начала каждого вебинара я пришлю вам письмо со ссылкой на трансляцию. Ссылки также появятся в приложении «Гармонизатор», если вы войдёте в него с этим же email.\n\nДо встречи на вебинарах!\nСергей Замковой')
)
on conflict (provider, tier, currency) do nothing;

-- ── Контракты ──────────────────────────────────────────────────────────────
alter table public.payment_contracts
  add column if not exists source text not null default 'cabinet'
    check (source in ('cabinet', 'widget')),
  add column if not exists widget_id uuid,
  add column if not exists catalog_id uuid references public.payment_catalog(id) on delete set null,
  add column if not exists buyer_name text,
  add column if not exists buyer_locale text,
  add column if not exists buyer_letter_sent_at timestamptz;

comment on column public.payment_contracts.source is
  'Where checkout started: cabinet (signed-in account) or widget (landing page form).';

-- ── Виджеты ────────────────────────────────────────────────────────────────
create table if not exists public.payment_widgets (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  catalog_id  uuid references public.payment_catalog(id) on delete set null,
  config      jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.payment_widgets is
  'Embeddable payment forms for landing pages. Public config via /api/widget/:id; service role only.';

alter table public.payment_widgets enable row level security;

alter table public.payment_contracts
  drop constraint if exists payment_contracts_widget_id_fkey;
alter table public.payment_contracts
  add constraint payment_contracts_widget_id_fkey
  foreign key (widget_id) references public.payment_widgets(id) on delete set null;

-- ── Пропуск на вебинары ────────────────────────────────────────────────────
create table if not exists public.webinar_passes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  contract_id  text not null unique references public.payment_contracts(contract_id) on delete cascade,
  credits      integer not null check (credits > 0),
  valid_from   timestamptz not null,
  valid_until  timestamptz not null,
  status       text not null default 'active' check (status in ('active', 'revoked')),
  created_at   timestamptz not null default now(),
  check (valid_until > valid_from)
);

comment on table public.webinar_passes is
  'Paid right to join `credits` webinars that start in [valid_from, valid_until). Revoked on refund.';

create index if not exists idx_webinar_passes_user on public.webinar_passes (user_id);
create index if not exists idx_webinar_passes_active_until
  on public.webinar_passes (valid_until) where status = 'active';

alter table public.webinar_passes enable row level security;

drop policy if exists webinar_passes_read_own on public.webinar_passes;
create policy webinar_passes_read_own on public.webinar_passes
  for select to authenticated
  using (user_id = auth.uid());

alter table public.webinar_registrations
  add column if not exists pass_id uuid references public.webinar_passes(id) on delete set null,
  add column if not exists join_email_sent_at timestamptz;

create index if not exists idx_webinar_registrations_pass
  on public.webinar_registrations (pass_id) where pass_id is not null;

-- Записать владельцев пропусков на опубликованные вебинары их окна.
-- Вебинар, на который человек уже записан, кредит не тратит.
create or replace function public.apply_webinar_passes(p_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  p record;
  w record;
  v_used integer;
  v_count integer := 0;
  v_n integer;
begin
  for p in
    select wp.id, wp.user_id, wp.credits, wp.valid_from, wp.valid_until
    from public.webinar_passes wp
    join public.payment_contracts pc on pc.contract_id = wp.contract_id
    where wp.status = 'active'
      and pc.status = 'active'
      and wp.valid_until > now() - interval '1 hour'
      and (p_user_id is null or wp.user_id = p_user_id)
  loop
    select count(*) into v_used
    from public.webinar_registrations r
    where r.pass_id = p.id;
    if v_used >= p.credits then
      continue;
    end if;

    for w in
      select wb.id
      from public.webinars wb
      where wb.is_published
        and wb.starts_at >= p.valid_from
        and wb.starts_at < p.valid_until
        and wb.starts_at > now() - interval '1 hour'
        and not exists (
          select 1 from public.webinar_registrations r
          where r.webinar_id = wb.id and r.user_id = p.user_id
        )
      order by wb.starts_at
      limit (p.credits - v_used)
    loop
      insert into public.webinar_registrations (webinar_id, user_id, pass_id)
      values (w.id, p.user_id, p.id)
      on conflict (webinar_id, user_id) do nothing;
      get diagnostics v_n = row_count;
      v_count := v_count + v_n;
    end loop;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.apply_webinar_passes(uuid) from public, anon, authenticated;
grant execute on function public.apply_webinar_passes(uuid) to postgres, service_role;

-- Приложение: «Записаться» у владельца пропуска (вебинар опубликован раньше cron).
create or replace function public.apply_my_webinar_passes()
returns integer
language sql
security definer
set search_path = public
as $function$
  select case when auth.uid() is null then 0 else public.apply_webinar_passes(auth.uid()) end;
$function$;

revoke all on function public.apply_my_webinar_passes() from public, anon;
grant execute on function public.apply_my_webinar_passes() to authenticated, service_role;

-- Письмо со ссылкой на трансляцию: Vercel вызывается, только когда есть что слать.
create or replace function public.invoke_webinar_pass_emails()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://harmonizer-ten.vercel.app/api/cron/webinar-pass-emails';
  v_id bigint;
begin
  if not exists (
    select 1
    from public.webinar_registrations r
    join public.webinars w on w.id = r.webinar_id
    where r.pass_id is not null
      and r.join_email_sent_at is null
      and w.is_published
      and w.join_url is not null
      and btrim(w.join_url) <> ''
      and w.starts_at <= now() + interval '60 minutes'
      and w.starts_at >= now() - interval '15 minutes'
  ) then
    return null;
  end if;

  v_secret := public._cron_secret('precompute_global_cron_secret');
  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping webinar-pass-emails invoke';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
    into v_id;

  return v_id;
end;
$function$;

revoke all on function public.invoke_webinar_pass_emails() from public, anon, authenticated;
grant execute on function public.invoke_webinar_pass_emails() to postgres, service_role;

-- ── Реестр cron (копия 20260915184713 + два новых задания) ─────────────────
create or replace function public.ensure_harmonizer_cron_jobs()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'cron', 'extensions'
as $function$
declare
  repaired text[] := '{}';
  missing_invokers text[] := '{}';
  req record;
  stale record;
  invoker_name text;
  schedule_ok boolean;
begin
  for stale in
    select cj.jobid from cron.job cj where cj.jobname in ('precompute_daily_forecasts_hourly')
  loop
    perform cron.unschedule(stale.jobid);
  end loop;

  for req in
    select *
    from (
      values
        (
          'precompute_global_recommendations_hourly',
          '0 * * * *',
          'select public.invoke_precompute_global_recommendations();',
          'invoke_precompute_global_recommendations'
        ),
        (
          'precompute_daily_forecasts_every_10m',
          '*/10 * * * *',
          'select public.invoke_precompute_daily_forecasts();',
          'invoke_precompute_daily_forecasts'
        ),
        (
          'cleanup_expired_stories_hourly',
          '15 * * * *',
          'select public.invoke_cleanup_expired_stories();',
          'invoke_cleanup_expired_stories'
        ),
        (
          'reconcile_expired_memberships_hourly',
          '20 * * * *',
          'select public.invoke_reconcile_expired_memberships();',
          'invoke_reconcile_expired_memberships'
        ),
        (
          'cleanup_unconfirmed_auth_users_hourly',
          '35 * * * *',
          'select public.cleanup_unconfirmed_auth_users();',
          'cleanup_unconfirmed_auth_users'
        ),
        (
          'cleanup_stale_notification_deliveries_weekly',
          '37 4 * * 0',
          $cmd$select public.cleanup_stale_notification_deliveries(interval '30 days', 1000, 20);$cmd$,
          'cleanup_stale_notification_deliveries'
        ),
        (
          'notify_webinar_start_minutely',
          '* * * * *',
          'select public.invoke_notify_webinar_start();',
          'invoke_notify_webinar_start'
        ),
        (
          'run_email_automations_every_5m',
          '*/5 * * * *',
          'select public.invoke_run_email_automations();',
          'invoke_run_email_automations'
        ),
        (
          'run_email_campaigns_every_5m',
          '*/5 * * * *',
          'select public.invoke_run_email_campaigns();',
          'invoke_run_email_campaigns'
        ),
        (
          'sync_email_suppressions_daily',
          '20 5 * * *',
          'select public.invoke_sync_email_suppressions();',
          'invoke_sync_email_suppressions'
        ),
        (
          'run_yookassa_renewals_daily',
          '15 3 * * *',
          'select public.invoke_run_yookassa_renewals();',
          'invoke_run_yookassa_renewals'
        ),
        (
          'cleanup_daily_dialog_archives_hourly',
          '50 * * * *',
          'select public.cleanup_daily_dialog_archives();',
          'cleanup_daily_dialog_archives'
        ),
        (
          'cleanup_cron_job_run_details_daily',
          '40 4 * * *',
          'select public.cleanup_cron_job_run_details();',
          'cleanup_cron_job_run_details'
        ),
        (
          'apply_webinar_passes_every_5m',
          '2-59/5 * * * *',
          'select public.apply_webinar_passes();',
          'apply_webinar_passes'
        ),
        (
          'webinar_pass_emails_every_5m',
          '3-59/5 * * * *',
          'select public.invoke_webinar_pass_emails();',
          'invoke_webinar_pass_emails'
        ),
        (
          'ensure_harmonizer_crons_watchdog',
          '*/15 * * * *',
          'select public.ensure_harmonizer_cron_jobs();',
          'ensure_harmonizer_cron_jobs'
        )
    ) as t(jobname, schedule, command, invoker)
  loop
    invoker_name := req.invoker;

    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = invoker_name
    ) then
      missing_invokers := array_append(missing_invokers, req.jobname);
      raise warning '[ensure_harmonizer_cron_jobs] invoker missing for % (%)',
        req.jobname, invoker_name;
      continue;
    end if;

    select exists (
      select 1
      from cron.job cj
      where cj.jobname = req.jobname
        and cj.schedule = req.schedule
        and btrim(cj.command) = btrim(req.command)
        and cj.active
    )
      into schedule_ok;

    if schedule_ok then
      continue;
    end if;

    for stale in
      select cj.jobid
      from cron.job cj
      where cj.jobname = req.jobname
    loop
      perform cron.unschedule(stale.jobid);
    end loop;

    perform cron.schedule(req.jobname, req.schedule, req.command);
    repaired := array_append(repaired, req.jobname);
    raise warning '[ensure_harmonizer_cron_jobs] repaired schedule % (%)',
      req.jobname, req.schedule;
  end loop;

  return jsonb_build_object(
    'ok', coalesce(array_length(missing_invokers, 1), 0) = 0,
    'repaired', to_jsonb(coalesce(repaired, '{}'::text[])),
    'missing_invokers', to_jsonb(coalesce(missing_invokers, '{}'::text[])),
    'checked_at', now()
  );
end;
$function$;

revoke all on function public.ensure_harmonizer_cron_jobs() from public, anon, authenticated;
grant execute on function public.ensure_harmonizer_cron_jobs() to postgres, service_role;

select public.ensure_harmonizer_cron_jobs();

-- ── Контакты рассылки: источник «виджет» ──────────────────────────────────
alter table public.email_contacts drop constraint if exists email_contacts_source_check;
alter table public.email_contacts
  add constraint email_contacts_source_check
  check (source in ('imported', 'app', 'subscribe_form', 'manual', 'widget'));

-- ── Два стартовых виджета (RU) ─────────────────────────────────────────────
insert into public.payment_widgets (title, catalog_id, config)
select v.title, c.id, '{}'::jsonb
from (values ('Участие в вебинаре', 'webinar'), ('Четыре вебинара', 'webinar_pack')) as v(title, tier)
join public.payment_catalog c
  on c.provider = 'yookassa' and c.tier = v.tier and c.currency = 'RUB'
where not exists (select 1 from public.payment_widgets pw where pw.title = v.title);
