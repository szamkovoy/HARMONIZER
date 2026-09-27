-- One round-trip for the open pixel. Service role only.
-- Same counters as recordFirstPartyTrackEvent, with an atomic increment.

create or replace function public.record_first_party_email_open(p_track_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
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

  if v_key.contact_id is not null then
    update public.email_contacts
    set last_open_at = now(), updated_at = now()
    where id = v_key.contact_id;
  end if;

  if v_key.campaign_id is not null then
    update public.email_campaigns
    set opened_count = coalesce(opened_count, 0) + 1, updated_at = now()
    where id = v_key.campaign_id;
  end if;

  if v_key.step_id is not null then
    update public.email_automation_steps
    set opened_count = coalesce(opened_count, 0) + 1, updated_at = now()
    where id = v_key.step_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.record_first_party_email_open(uuid) from public, anon, authenticated;
grant execute on function public.record_first_party_email_open(uuid) to service_role;
