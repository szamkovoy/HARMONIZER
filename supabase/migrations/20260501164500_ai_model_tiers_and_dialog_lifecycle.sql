-- AI model tiers and dialogue lifecycle.

-- Store only model tiers in prompt metadata. Runtime maps tiers to concrete env models.
UPDATE public.prompts
SET model_hint = CASE
  WHEN model_hint ILIKE '%pro%' OR prompt_key IN ('calibration_extraction', 'recommendation_long', 'portrait_generation') THEN 'premium'
  ELSE 'standard'
END
WHERE model_hint IS NULL
   OR model_hint NOT IN ('standard', 'premium');

DO $$
BEGIN
  IF to_regclass('public.scenarios') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE public.scenarios
      SET model_hint = CASE
        WHEN model_hint ILIKE '%pro%' THEN 'premium'
        ELSE 'standard'
      END
      WHERE model_hint IS NULL
         OR model_hint NOT IN ('standard', 'premium')
    $sql$;
  END IF;
END $$;

ALTER TABLE public.prompts
DROP CONSTRAINT IF EXISTS prompts_model_hint_tier;

ALTER TABLE public.prompts
ADD CONSTRAINT prompts_model_hint_tier
CHECK (model_hint IS NULL OR model_hint IN ('standard', 'premium'));

DO $$
BEGIN
  IF to_regclass('public.scenarios') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.scenarios DROP CONSTRAINT IF EXISTS scenarios_model_hint_tier';
    EXECUTE 'ALTER TABLE public.scenarios ADD CONSTRAINT scenarios_model_hint_tier CHECK (model_hint IS NULL OR model_hint IN (''standard'', ''premium''))';
  END IF;
END $$;

-- Fast session TTL checks: keep conversations.last_message_at in sync with messages.
ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

UPDATE public.conversations c
SET last_message_at = COALESCE(m.max_created_at, c.started_at, c.created_at)
FROM (
  SELECT conversation_id, max(created_at) AS max_created_at
  FROM public.messages
  GROUP BY conversation_id
) m
WHERE c.id = m.conversation_id
  AND c.last_message_at IS NULL;

UPDATE public.conversations
SET last_message_at = COALESCE(started_at, created_at, now())
WHERE last_message_at IS NULL;

CREATE OR REPLACE FUNCTION public.touch_conversation_last_message_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = COALESCE(NEW.created_at, now())
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_touch_conversation_last_message_at ON public.messages;
CREATE TRIGGER messages_touch_conversation_last_message_at
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_conversation_last_message_at();

CREATE INDEX IF NOT EXISTS conversations_user_last_message_idx
  ON public.conversations (user_id, last_message_at DESC);

-- Active responder prompt receives transparent daily background summary slot.
UPDATE public.prompts
SET
  template = replace(
    template,
    '=== КОНТЕКСТ ДНЯ (только для daily_dialog) ===
{{daily_context}}

=== ОСНОВНЫЕ ЖЁСТКИЕ ПРАВИЛА ===',
    '=== КОНТЕКСТ ДНЯ (только для daily_dialog) ===
{{daily_context}}

=== BACKGROUND OF THE DAY ===
Если здесь есть краткая сводка предыдущих сессий этого же локального дня, используй её только как фон. Не цитируй её как новую реплику пользователя и не делай вид, что эти сообщения прямо сейчас видны в чате.
{{daily_background}}

=== ОСНОВНЫЕ ЖЁСТКИЕ ПРАВИЛА ==='
  ),
  variables = variables || '{"daily_background":{"type":"string","required":false}}'::jsonb
WHERE prompt_key = 'responder_main'
  AND is_active = true
  AND template NOT LIKE '%{{daily_background}}%';
