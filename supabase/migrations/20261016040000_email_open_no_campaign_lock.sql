-- The open pixel still did opened_count = opened_count + 1 on the single
-- campaign row. Delivery webhooks no longer do that, but each open of an
-- already-sent letter took the same lock and filled the connection pool.
-- The pixel now marks this letter opened. The 5-minute rollup counts it.

create or replace function public.record_first_party_email_open(p_track_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '4s'
as $function$
declare
  v_key public.email_tracking_keys%rowtype;
begin
  select * into v_key
  from public.email_tracking_keys
  where id = p_track_id;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  begin
    insert into public.email_events (
      send_id, contact_id, campaign_id, resend_id, event_type, payload
    ) values (
      v_key.send_id,
      v_key.contact_id,
      v_key.campaign_id,
      v_key.resend_id,
      'email.opened',
      jsonb_build_object('source', 'first_party', 'track_id', v_key.id)
    );
  exception
    when unique_violation then
      return jsonb_build_object('ok', true, 'duplicate', true);
  end;

  if v_key.send_id is not null then
    update public.email_campaign_sends
    set status = 'opened'
    where id = v_key.send_id
      and status in ('queued', 'sending', 'sent', 'delivered');
  end if;

  if v_key.contact_id is not null then
    update public.email_contacts
    set last_open_at = now(), updated_at = now()
    where id = v_key.contact_id;
  end if;

  -- Automation volume is a few letters, not a whole list. Keep the step
  -- counter immediate. Campaign totals stay on the 5-minute rollup.
  if v_key.step_id is not null then
    update public.email_automation_steps
    set opened_count = coalesce(opened_count, 0) + 1, updated_at = now()
    where id = v_key.step_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

-- Opens already stored only as events, while the send row stayed
-- 'delivered'. Point those rows at opened/clicked so the rollup keeps them.
update public.email_campaign_sends s
set status = 'opened'
where s.status in ('sent', 'delivered')
  and exists (
    select 1
    from public.email_events e
    where e.send_id = s.id
      and e.event_type = 'email.opened'
  );

update public.email_campaign_sends s
set status = 'clicked'
where s.status in ('sent', 'delivered', 'opened')
  and exists (
    select 1
    from public.email_events e
    where e.send_id = s.id
      and e.event_type = 'email.clicked'
  );
