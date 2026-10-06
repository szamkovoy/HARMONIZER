-- claim_email_campaign_batch fills missing unsubscribe tokens with
-- gen_random_bytes, which lives in extensions (pgcrypto). search_path=public
-- made the first resume tick return HTTP 500 before any row was claimed.

create or replace function public.claim_email_campaign_batch(
  p_campaign_id uuid,
  p_limit int default 100,
  p_stale_minutes int default 15
)
returns table (
  send_id uuid,
  contact_id uuid,
  send_locale text,
  batch_key uuid,
  email text,
  contact_locale text,
  unsubscribe_token text,
  marketing_status text,
  display_name text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key uuid;
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 100));
begin
  select s.batch_key into v_key
  from public.email_campaign_sends s
  where s.campaign_id = p_campaign_id
    and s.status = 'sending'
    and s.claimed_at < now() - make_interval(mins => greatest(1, p_stale_minutes))
  order by s.claimed_at
  limit 1;

  if v_key is not null then
    update public.email_campaign_sends s
    set claimed_at = now()
    where s.campaign_id = p_campaign_id
      and s.batch_key = v_key
      and s.status = 'sending';
  else
    v_key := gen_random_uuid();
    update public.email_campaign_sends s
    set status = 'sending', batch_key = v_key, claimed_at = now()
    where s.id in (
      select q.id
      from public.email_campaign_sends q
      where q.campaign_id = p_campaign_id
        and q.status = 'queued'
      order by q.created_at
      limit v_limit
      for update skip locked
    );
  end if;

  update public.email_contacts c
  set unsubscribe_token = encode(extensions.gen_random_bytes(24), 'hex')
  where c.unsubscribe_token is null
    and c.id in (
      select s.contact_id from public.email_campaign_sends s
      where s.campaign_id = p_campaign_id and s.batch_key = v_key and s.status = 'sending'
    );

  return query
  select
    s.id,
    s.contact_id,
    s.locale,
    s.batch_key,
    c.email,
    c.locale,
    c.unsubscribe_token,
    c.marketing_status,
    u.display_name
  from public.email_campaign_sends s
  join public.email_contacts c on c.id = s.contact_id
  left join public.users u on u.id = c.user_id
  where s.campaign_id = p_campaign_id
    and s.batch_key = v_key
    and s.status = 'sending'
  order by s.created_at, s.id;
end;
$$;

revoke all on function public.claim_email_campaign_batch(uuid, int, int) from public, anon, authenticated;
grant execute on function public.claim_email_campaign_batch(uuid, int, int) to service_role;
