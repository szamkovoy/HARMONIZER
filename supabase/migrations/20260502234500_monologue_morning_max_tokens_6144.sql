-- Исправление лимита токенов для утреннего монолога: миграция 20260501185700 уже
-- могла быть применена на remote до правки max_output_tokens → 6144 в файле.
-- Этот патч идемпотентен и гарантирует значение в БД.

update public.prompts
set max_output_tokens = 6144
where prompt_key = 'monologue_morning_recommendation'
  and version = 2
  and is_active = true;
