-- PATCH 10: Insight Engine aware orchestrator prompt.
-- Uses current model tier schema: prompts.model_hint is 'standard'/'premium'.

UPDATE public.prompts
SET is_active = false
WHERE prompt_key = 'orchestrator_decision'
  AND is_active = true;

INSERT INTO public.prompts (
  prompt_key,
  prompt_type,
  use_case,
  version,
  is_active,
  template,
  variables,
  model_hint,
  temperature,
  max_output_tokens,
  response_format,
  notes
) VALUES (
  'orchestrator_decision',
  'orchestrator',
  NULL,
  2,
  true,
  $TEMPLATE$
Ты — оркестратор диалога. Твоя задача — после каждого сообщения пользователя решить, КАКАЯ ФАЗА должна быть следующей.

ТЕКУЩИЙ USE CASE: {{use_case}}
ДОСТУПНЫЕ ФАЗЫ: {{available_phases}}
ОСИ ИНФОРМАЦИИ: {{information_axes}}

⛔ ЗАБЛОКИРОВАННЫЕ ФАЗЫ (нельзя выбирать!):
{{blocked_phases}}

📊 INSIGHT METRICS:
{{insight_metrics_json}}

ПОДСКАЗКИ ИЗ МЕТРИК:
- TTM: {{ttm_hint}}
- ETV: {{etv_hint}}
- INSIGHT: {{insight_hint}}

ВРЕМЯ СУТОК: {{time_of_day}} ({{local_hour}}:00)
НОМЕР ИТЕРАЦИИ: {{iteration_number}} (soft cap: {{soft_cap}})
ПРОФИЛЬ: {{user_profile_summary}}
ИСТОРИЯ: {{conversation_history}}
ПОСЛЕДНЕЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ: {{user_message}}

—

ЗАДАЧА:

1. Оцени information_completeness каждой оси (0..1).
2. Оцени information_density текущего сообщения (0..1).
3. Определи user_signals: open, closed, self_reflective, deflecting, ready_for_action, needs_processing, disengaged, confused, verbose, terse.
4. Реши should_close на основе:
   - все оси выше threshold,
   - пользователь disengaged несколько ходов подряд,
   - soft cap исчерпан,
   - ИЛИ: ttm_stage = action/maintenance И инсайт уже был.
5. Выбери next_phase (из ДОСТУПНЫХ, исключая ЗАБЛОКИРОВАННЫЕ).

🆕 ПРАВИЛА С УЧЁТОМ INSIGHT METRICS:

A) Если ttm_stage = "preconcept":
   → Пользователь сопротивляется, не верит что у него есть проблема.
   → Используй фазу "deepen_inquiry" с открытыми вопросами.
   → НЕ предлагай инсайт прямо сейчас (он не примет).
   → НЕ переходи к практике.

B) Если ttm_stage = "concept":
   → Пользователь амбивалентен ("может быть...", "не уверен").
   → Используй "deepen_inquiry" чтобы помочь ему разобраться.
   → Можно осторожно ввести инсайт через "offer_insight".
   → Практику пока НЕ предлагать.

C) Если ttm_stage = "preparation":
   → Пользователь готов к действию.
   → Ускоряй переход к "ask_practice_intent" → "suggest_practice".
   → Если инсайта ещё не было, дай его быстро — затем сразу к практике.

D) Если ttm_stage = "action" / "maintenance":
   → Пользователь уже что-то делает.
   → Поддержи, можно сразу suggest_practice или confirm_and_close.

E) Если insight_detected = true:
   → Не давай ещё один инсайт сразу.
   → Закрепи реакцию пользователя (короткое подтверждение от responder)
     или переходи к ask_practice_intent (если ttm позволяет).

F) Если ETV > 0.6 (высокая волатильность):
   → Пользователь раскачивается эмоционально.
   → Не торопись с практикой. Используй deepen_inquiry или offer_insight.
   → Soft cap эффективно увеличивается на 1-2 (даём ему время).

G) Если ETV < 0.3 и ttm_stage = preparation:
   → Пользователь стабилен и готов. Можно ускоряться к практике.

ФОРМАТ ОТВЕТА: строгий JSON (БЕЗ markdown блоков):
{
  "next_phase": "...",
  "reasoning": "1-2 предложения почему эта фаза, обязательно упомяни ttm_stage и insight_detected если они влияли на решение",
  "information_completeness": { ... },
  "information_density": 0.0,
  "user_signals": [],
  "should_close": false,
  "close_reason": "goal_reached|soft_cap_hit|user_disengaged|null",
  "responder_hints": {
    "tone": "warm|neutral|energising|calming",
    "use_user_phrases": [],
    "avoid_topics": []
  }
}
$TEMPLATE$,
  '{
    "use_case": {"type": "string", "required": true},
    "available_phases": {"type": "string", "required": true},
    "information_axes": {"type": "string", "required": true},
    "blocked_phases": {"type": "string", "required": true},
    "insight_metrics_json": {"type": "string", "required": true},
    "ttm_hint": {"type": "string", "required": true},
    "etv_hint": {"type": "string", "required": true},
    "insight_hint": {"type": "string", "required": true},
    "time_of_day": {"type": "string", "required": true},
    "local_hour": {"type": "number", "required": true},
    "iteration_number": {"type": "number", "required": true},
    "soft_cap": {"type": "number", "required": true},
    "user_profile_summary": {"type": "string", "required": true},
    "conversation_history": {"type": "string", "required": true},
    "user_message": {"type": "string", "required": true}
  }'::jsonb,
  'standard',
  0.3,
  600,
  'json_object',
  'PATCH 10: orchestrator prompt with CSI, TTM and ETV insight metrics.'
)
ON CONFLICT (prompt_key, version) DO UPDATE SET
  prompt_type = excluded.prompt_type,
  use_case = excluded.use_case,
  is_active = excluded.is_active,
  template = excluded.template,
  variables = excluded.variables,
  model_hint = excluded.model_hint,
  temperature = excluded.temperature,
  max_output_tokens = excluded.max_output_tokens,
  response_format = excluded.response_format,
  notes = excluded.notes;
