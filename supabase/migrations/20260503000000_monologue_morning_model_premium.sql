-- Утренний монолог вызывается только у платного/триала (не free global).
-- Используем tier premium → AI_MODEL_PREMIUM из env, как ожидает продукт.

update public.prompts
set model_hint = 'premium'
where prompt_key = 'monologue_morning_recommendation'
  and is_active = true;
