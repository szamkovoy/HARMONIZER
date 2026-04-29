-- ============================================================================
-- Tighten RLS: natal/forecast caches read-only for owner; proposals content locked
-- ============================================================================

-- -----------------------------------------------------------------------------
-- 1. user_natal_charts — только SELECT для владельца (запись через service_role)
-- -----------------------------------------------------------------------------
drop policy if exists user_natal_charts_self on public.user_natal_charts;
drop policy if exists natal_charts_select_own on public.user_natal_charts;
drop policy if exists natal_charts_all_own on public.user_natal_charts;

create policy natal_charts_select_own on public.user_natal_charts
  for select
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 2. user_daily_forecasts — только SELECT для владельца
-- -----------------------------------------------------------------------------
drop policy if exists user_daily_forecasts_self on public.user_daily_forecasts;
drop policy if exists daily_forecasts_select_own on public.user_daily_forecasts;
drop policy if exists daily_forecasts_all_own on public.user_daily_forecasts;

create policy daily_forecasts_select_own on public.user_daily_forecasts
  for select
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 3. ai_state_proposals — SELECT + UPDATE (status) для владельца; контент защищён триггером
-- -----------------------------------------------------------------------------
drop policy if exists proposals_update_own on public.ai_state_proposals;
drop policy if exists proposals_select_own on public.ai_state_proposals;
drop policy if exists ai_state_proposals_update_own on public.ai_state_proposals;
drop policy if exists ai_state_proposals_select_own on public.ai_state_proposals;
drop policy if exists ai_state_proposals_self on public.ai_state_proposals;

create policy proposals_select_own on public.ai_state_proposals
  for select
  using (user_id = auth.uid());

create policy proposals_update_own on public.ai_state_proposals
  for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and status in ('pending', 'accepted', 'rejected', 'expired')
  );

drop trigger if exists proposals_protect_content on public.ai_state_proposals;
drop function if exists public.protect_proposal_content();

create or replace function public.protect_proposal_content()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Только end-user JWT: service_role / backend обходит эту проверку.
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' then
    if new.proposed_planet is distinct from old.proposed_planet
       or new.proposed_label is distinct from old.proposed_label
       or new.proposed_polarity is distinct from old.proposed_polarity
       or new.trigger_phrase is distinct from old.trigger_phrase
       or new.conversation_id is distinct from old.conversation_id
       or new.created_at is distinct from old.created_at
       or new.expires_at is distinct from old.expires_at
       or new.user_id is distinct from old.user_id then
      raise exception 'Only status and responded_at can be modified by user';
    end if;
  end if;
  return new;
end;
$$;

create trigger proposals_protect_content
  before update on public.ai_state_proposals
  for each row
  execute function public.protect_proposal_content();

-- -----------------------------------------------------------------------------
-- 4. user_event_log — политика без изменений; комментарий из аудита
-- -----------------------------------------------------------------------------
comment on table public.user_event_log is
  'User event log. Клиент может писать свои события (UI clicks, etc.). Системные события пишет backend через service_role.';
