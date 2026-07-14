-- Allow the signed-in user to claim an Expo push token even if it was
-- previously registered under a different user_id (RLS blocked plain upsert).

create or replace function public.claim_push_token(
  p_token text,
  p_platform text,
  p_expo_token boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if p_token is null or length(btrim(p_token)) = 0 then
    raise exception 'token required';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android', 'web') then
    raise exception 'invalid platform';
  end if;

  insert into public.push_tokens as t (
    user_id, token, platform, expo_token, is_active, last_seen_at
  )
  values (
    uid, btrim(p_token), p_platform, coalesce(p_expo_token, true), true, now()
  )
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        expo_token = excluded.expo_token,
        is_active = true,
        last_seen_at = now();
end;
$$;

revoke all on function public.claim_push_token(text, text, boolean) from public;
grant execute on function public.claim_push_token(text, text, boolean) to authenticated;

comment on function public.claim_push_token(text, text, boolean) is
  'Upsert push token for auth.uid(); reassigns token from any previous owner.';
