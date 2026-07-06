-- ============================================================================
-- Remote Play: allow an authenticated owner to close their own tv_sessions.
-- ----------------------------------------------------------------------------
-- The original policy tv_sessions_update_authenticated_owner (migration
-- 20260503014500_remote_play_tv_sessions.sql) allowed an authenticated owner
-- to set status only to ('waiting','playing','paused','stopped') — NOT 'closed'.
-- That made the stale-session cleanup in linkDevice() fail with RLS, which
-- surfaced to the user as "Не удалось обновить прежние ТВ-сессии." and blocked
-- linking a new TV code. Anon could already close (tv_sessions_close_anon);
-- this lifts the same capability for the authenticated owner on rows they own.
-- ============================================================================

drop policy if exists tv_sessions_update_authenticated_owner on public.tv_sessions;

create policy tv_sessions_update_authenticated_owner on public.tv_sessions
  for update
  using (
    auth.role() = 'authenticated'
    and expires_at > now()
    and status <> 'closed'
    and (user_id is null or user_id = auth.uid())
  )
  with check (
    auth.role() = 'authenticated'
    and expires_at > now()
    and user_id = auth.uid()
    and status in ('waiting', 'playing', 'paused', 'stopped', 'closed')
  );
