-- =============================================================
-- REVERT dialog_quality_v4
-- Деактивирует версии, введённые v4, и реактивирует предыдущие.
-- Применять только после ревью SQL (Supabase SQL Editor или db push).
-- =============================================================

BEGIN;

-- responder_main: v4 off → v3 on
UPDATE public.prompts
SET is_active = false
WHERE prompt_key = 'responder_main' AND version = 4 AND is_active = true;

UPDATE public.prompts
SET is_active = true
WHERE prompt_key = 'responder_main' AND version = 3;

-- orchestrator_decision: v3 off → v2 on
UPDATE public.prompts
SET is_active = false
WHERE prompt_key = 'orchestrator_decision' AND version = 3 AND is_active = true;

UPDATE public.prompts
SET is_active = true
WHERE prompt_key = 'orchestrator_decision' AND version = 2;

-- phase_collect_state: v3 off → v2 on
UPDATE public.prompts
SET is_active = false
WHERE prompt_key = 'phase_collect_state' AND version = 3 AND is_active = true;

UPDATE public.prompts
SET is_active = true
WHERE prompt_key = 'phase_collect_state' AND version = 2;

-- phase_deepen_inquiry: v3 off → v2 on
UPDATE public.prompts
SET is_active = false
WHERE prompt_key = 'phase_deepen_inquiry' AND version = 3 AND is_active = true;

UPDATE public.prompts
SET is_active = true
WHERE prompt_key = 'phase_deepen_inquiry' AND version = 2;

-- phase_offer_insight: v3 off → v2 on
UPDATE public.prompts
SET is_active = false
WHERE prompt_key = 'phase_offer_insight' AND version = 3 AND is_active = true;

UPDATE public.prompts
SET is_active = true
WHERE prompt_key = 'phase_offer_insight' AND version = 2;

-- phase_contextual_greeting: v4 off → v3 on
UPDATE public.prompts
SET is_active = false
WHERE prompt_key = 'phase_contextual_greeting' AND version = 4 AND is_active = true;

UPDATE public.prompts
SET is_active = true
WHERE prompt_key = 'phase_contextual_greeting' AND version = 3;

COMMIT;
