-- Security hardening from the Supabase advisor run of 2026-09-14.
--
-- Supabase grants EXECUTE on every new function in `public` to anon/authenticated by
-- default, so 40 SECURITY DEFINER server-side functions were callable through
-- `/rest/v1/rpc/*` with the publishable key — including payment-ledger reattachment,
-- membership recompute, OTP permit issuance and every pg_cron invoker.
--
-- Client-callable RPC (kept for anon + authenticated, referenced from `modules/**`):
--   claim_push_token, get_posts_feed, get_story_feed, get_target_comments,
--   get_user_announcement, get_user_stories, set_signin_name_hint,
--   record_inbox_notification, otp_check_verify_allowed, otp_record_verify_failure,
--   is_admin (used inside RLS policies — must stay executable by the querying role).
-- Everything else below is server-only (Vercel / Edge Functions with service_role,
-- pg_cron as postgres, or trigger functions that PostgREST never exposes).

do $$
declare
  fn record;
  server_only text[] := array[
    -- payments / membership
    'reattach_payment_ledger_for_email',
    'restore_membership_from_ledger',
    -- OTP permits (issued/consumed by the Vercel otp-gate route and send-auth-email)
    'otp_check_send_limits',
    'otp_consume_send_permit',
    'otp_issue_send_permit',
    '_otp_email_ok',
    '_otp_normalize_email',
    -- marketing email automations (Vercel runner + admin routes)
    'email_automation_confirmed_users',
    'email_automation_onboarded_users',
    'email_automation_welcome_candidates',
    'shift_email_automation_enrollments_after_pause',
    'sync_email_contact_for_user',
    'sync_email_contacts_from_users',
    -- cron registry + invokers
    'ensure_harmonizer_cron_jobs',
    'invoke_cleanup_expired_stories',
    'invoke_email_welcome_for_user',
    'invoke_notify_webinar_start',
    'invoke_precompute_daily_forecasts',
    'invoke_precompute_global_recommendations',
    'invoke_reconcile_expired_memberships',
    'invoke_run_email_automations',
    'invoke_run_yookassa_renewals',
    'invoke_sync_email_suppressions',
    '_cron_secret',
    'reconcile_expired_memberships',
    -- trigger / event-trigger bodies
    'handle_new_auth_user',
    'protect_proposal_content',
    'protect_tv_session_anon_update',
    'recompute_user_daily_stats',
    'touch_conversation_last_message_at',
    'trg_users_onboarded_email_welcome',
    'update_practice_preferences',
    'set_updated_at',
    'support_attachments_enforce_max',
    'user_affirmations_set_updated_at',
    'rls_auto_enable'
  ];
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (server_only)
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    execute format('grant execute on function %s to postgres, service_role', fn.sig);
  end loop;
end
$$;

-- Trigger on auth.users fires as supabase_auth_admin; keep it explicit.
grant execute on function public.handle_new_auth_user() to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- function_search_path_mutable: pin search_path on the remaining helpers.
-- Bodies only reference pg_catalog builtins and public.* tables.
-- ---------------------------------------------------------------------------
alter function public.set_updated_at() set search_path = public;
alter function public.user_affirmations_set_updated_at() set search_path = public;
alter function public.support_attachments_enforce_max() set search_path = public;
alter function public.admin_user_access_segment(text, timestamptz, timestamptz) set search_path = public;
alter function public._otp_normalize_email(text) set search_path = public;
alter function public._otp_email_ok(text) set search_path = public;

-- ---------------------------------------------------------------------------
-- extension_in_public: pg_trgm has no dependents (no trgm indexes/functions/policies).
-- ---------------------------------------------------------------------------
create schema if not exists extensions;
do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm' and n.nspname = 'public'
  ) then
    alter extension pg_trgm set schema extensions;
  end if;
end
$$;
