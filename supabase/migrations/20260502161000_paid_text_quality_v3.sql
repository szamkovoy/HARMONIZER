-- Tighten paid morning recommendation and assistant voice prompts.
-- The model tier remains prompt-driven; paid morning uses premium.

update public.prompts
set is_active = false
where prompt_key in ('monologue_morning_recommendation', 'responder_main', 'phase_contextual_greeting')
  and is_active = true;

insert into public.prompts (
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
)
select
  prompt_key,
  prompt_type,
  use_case,
  3,
  true,
  replace(
    template,
    'СТРУКТУРА SHORT_TEXT (целевая длина ~{{short_text_target}} знаков)',
    'КАЧЕСТВЕННЫЙ ОРИЕНТИР ДЛЯ SHORT_TEXT

Этот текст должен звучать НЕ слабее общего бесплатного дайджеста, но быть тоньше за счёт персонального фильтра.
Пиши как живой литературный наставник, а не как чат-бот, гороскоп или слишком фамильярный коуч.

ОБЯЗАТЕЛЬНО:
- сначала состояние дня человеческим языком, потом личный нюанс;
- меньше сырой астрологии в коротком тексте, больше конкретных состояний;
- без сленга, уменьшительных, театрального драматизма и риторических вопросов подряд;
- не начинать с «Слушай, знаешь» чаще одного раза за генерацию; лучше «Сегодня...», «Заметь...», «На этой волне...»;
- не писать «проверь сам», «лямбами», «треплет», «искрит высоковольтный провод» и похожие случайные метафоры;
- финал должен приглашать к практике мягко, без приказа.

СТРУКТУРА SHORT_TEXT (целевая длина ~{{short_text_target}} знаков)'
  ),
  variables,
  'premium',
  temperature,
  greatest(coalesce(max_output_tokens, 2200), 6144),
  response_format,
  'PATCH: paid morning prompt v3, closer to global digest literary quality.'
from public.prompts
where prompt_key = 'monologue_morning_recommendation'
  and version = 2
on conflict (prompt_key, version) do update
set is_active = excluded.is_active,
    template = excluded.template,
    variables = excluded.variables,
    model_hint = excluded.model_hint,
    temperature = excluded.temperature,
    max_output_tokens = excluded.max_output_tokens,
    response_format = excluded.response_format,
    notes = excluded.notes;

insert into public.prompts (
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
)
select
  prompt_key,
  prompt_type,
  use_case,
  3,
  true,
  replace(
    template,
    '=== ОСНОВНЫЕ ЖЁСТКИЕ ПРАВИЛА ===',
    '=== КАЧЕСТВЕННЫЙ ОРИЕНТИР ===

Ответ должен звучать как короткая живая реплика человека, который слышит состояние пользователя.
Не используй канцелярит, терапевтические штампы и меню вариантов вида «ясность, энергия, спокойствие...», если пользователь сам не просит выбрать.
Если это первый ответ после приветствия, не повторяй приветствие и не пересказывай рекомендацию дня; сразу сделай один точный человеческий ход.

Запрещённые заготовки:
- «Что сейчас важнее: ясность, энергия, спокойствие...»
- «Я здесь, чтобы помочь»
- «Давайте разберёмся»
- «Это может быть связано с...»
- длинные объяснения вместо одного точного вопроса.

=== ОСНОВНЫЕ ЖЁСТКИЕ ПРАВИЛА ==='
  ),
  variables,
  model_hint,
  temperature,
  greatest(coalesce(max_output_tokens, 500), 650),
  response_format,
  'PATCH: responder v3 with stronger live voice and anti-cliche constraints.'
from public.prompts
where prompt_key = 'responder_main'
  and version = 2
on conflict (prompt_key, version) do update
set is_active = excluded.is_active,
    template = excluded.template,
    variables = excluded.variables,
    model_hint = excluded.model_hint,
    temperature = excluded.temperature,
    max_output_tokens = excluded.max_output_tokens,
    response_format = excluded.response_format,
    notes = excluded.notes;

insert into public.prompts (
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
)
select
  prompt_key,
  prompt_type,
  use_case,
  3,
  true,
  replace(
    template,
    '3. Задай ОДИН вопрос с учётом времени суток.',
    '3. Задай ОДИН вопрос с учётом времени суток.
4. Не предлагай список вариантов («ясность, энергия, спокойствие...»). Это звучит как анкета.
5. Не пересказывай весь short_text. Возьми один живой нерв дня и спроси про него.'
  ),
  variables,
  model_hint,
  temperature,
  max_output_tokens,
  response_format,
  'PATCH: contextual greeting v3, less generic opening question.'
from public.prompts
where prompt_key = 'phase_contextual_greeting'
  and version = 2
on conflict (prompt_key, version) do update
set is_active = excluded.is_active,
    template = excluded.template,
    variables = excluded.variables,
    model_hint = excluded.model_hint,
    temperature = excluded.temperature,
    max_output_tokens = excluded.max_output_tokens,
    response_format = excluded.response_format,
    notes = excluded.notes;
