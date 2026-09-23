-- The sign-in grant sets a transaction-local flag so the row guard lets that
-- write through. Clear it before the grant function returns, otherwise a later
-- statement in the same transaction could change trial_expires_at.

create or replace function public.grant_harmonizer_trial_if_first_entry(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('harmonizer.trial_write', 'server', true);

  update public.users u
  set
    app_first_open_at = now(),
    trial_expires_at = case
      when u.trial_expires_at is null
        and coalesce(u.store_review_account, false) = false
        and not public.user_has_active_paid_plan(u.membership_tier, u.membership_expires_at)
      then now() + interval '1 day'
      else u.trial_expires_at
    end
  where u.id = p_user_id
    and u.app_first_open_at is null
    and u.onboarded_at is null
    and u.last_seen_at is null;

  perform set_config('harmonizer.trial_write', '', true);
end;
$$;

revoke all on function public.grant_harmonizer_trial_if_first_entry(uuid) from public;
revoke all on function public.grant_harmonizer_trial_if_first_entry(uuid) from anon;
revoke all on function public.grant_harmonizer_trial_if_first_entry(uuid) from authenticated;
grant execute on function public.grant_harmonizer_trial_if_first_entry(uuid) to supabase_auth_admin;
