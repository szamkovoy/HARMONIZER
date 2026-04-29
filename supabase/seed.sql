-- =============================================================================
-- HARMONIZER — seed: справочник чакр + каталог дыхательных практик.
-- Идемпотентен (ON CONFLICT DO NOTHING/UPDATE) — безопасно запускать повторно.
-- =============================================================================

-- 7 чакр
insert into public.chakras (id, slug, name, color_hex) values
  (1, 'muladhara',    '{"ru":"Муладхара","en":"Muladhara"}',       '#E53935'),
  (2, 'svadhisthana', '{"ru":"Свадхистана","en":"Svadhisthana"}',  '#FB8C00'),
  (3, 'manipura',     '{"ru":"Манипура","en":"Manipura"}',         '#FDD835'),
  (4, 'anahata',      '{"ru":"Анахата","en":"Anahata"}',           '#43A047'),
  (5, 'vishuddha',    '{"ru":"Вишуддха","en":"Vishuddha"}',        '#29B6F6'),
  (6, 'ajna',         '{"ru":"Аджна","en":"Ajna"}',                '#3949AB'),
  (7, 'sahasrara',    '{"ru":"Сахасрара","en":"Sahasrara"}',       '#8E24AA')
on conflict (id) do update set
  slug      = excluded.slug,
  name      = excluded.name,
  color_hex = excluded.color_hex;

-- =============================================================================
-- Дыхательные практики — синхронизированы с BREATH_PRACTICES
-- (modules/breath/core/practices.ts) + i18n названиями.
-- params.indicatorKind / channelMode / normalBaseBeats — для клиента.
-- =============================================================================

insert into public.practices
  (slug, kind, title, description, default_duration_sec,
   min_duration_sec, max_duration_sec, params, rating, is_active, version)
values
  ('coherent', 'breath',
   '{"ru":"Когерентное дыхание","en":"Coherent breathing"}',
   '{"ru":"Сама-Вритти. Резонансная частота парасимпатической вариабельности HRV.","en":"Sama Vritti. Resonant frequency for parasympathetic HRV."}',
   600, 120, 1800,
   '{"indicatorKind":"bar","channelMode":"both","normalBaseBeats":6,"minBaseBeats":1,"maxBaseBeats":10}',
   0.9, true, 1),

  ('nadi-shodhana', 'breath',
   '{"ru":"Попеременное дыхание ноздрями","en":"Alternate nostril breathing"}',
   '{"ru":"Нади Шодхана. Баланс полушарий, очищение каналов ида/пингала.","en":"Nadi Shodhana. Hemispheric balance, channel purification."}',
   480, 120, 1200,
   '{"indicatorKind":"dual-bar","channelMode":"alternating","normalBaseBeats":6,"minBaseBeats":1,"maxBaseBeats":10}',
   0.85, true, 1),

  ('surya-bhedana', 'breath',
   '{"ru":"Дыхание правой ноздрёй","en":"Right-nostril breathing"}',
   '{"ru":"Сурья Бхедана. Активация, солнечный канал.","en":"Surya Bhedana. Activation, solar channel."}',
   300, 120, 900,
   '{"indicatorKind":"dual-bar","channelMode":"right","normalBaseBeats":6,"minBaseBeats":1,"maxBaseBeats":10}',
   0.7, true, 1),

  ('chandra-bhedana', 'breath',
   '{"ru":"Дыхание левой ноздрёй","en":"Left-nostril breathing"}',
   '{"ru":"Чандра Бхедана. Охлаждение, лунный канал.","en":"Chandra Bhedana. Cooling, lunar channel."}',
   300, 120, 900,
   '{"indicatorKind":"dual-bar","channelMode":"left","normalBaseBeats":6,"minBaseBeats":1,"maxBaseBeats":10}',
   0.7, true, 1),

  ('square', 'breath',
   '{"ru":"Дыхание ''Квадрат''","en":"Square breathing"}',
   '{"ru":"Чатуранга пранаяма 1:1:1:1. Стабильность, заземление.","en":"Chaturanga pranayama 1:1:1:1. Stability, grounding."}',
   480, 120, 1200,
   '{"indicatorKind":"square","channelMode":"both","normalBaseBeats":4,"minBaseBeats":1,"maxBaseBeats":10}',
   0.75, true, 1),

  ('triangle-up', 'breath',
   '{"ru":"Треугольник вершиной вверх","en":"Triangle (apex up)"}',
   '{"ru":"Висама-Вритти · Бахир Кумбхака: вдох-выдох-задержка.","en":"Vishama Vritti with post-exhalation retention."}',
   360, 120, 900,
   '{"indicatorKind":"triangle-up","channelMode":"both","normalBaseBeats":5,"minBaseBeats":1,"maxBaseBeats":10}',
   0.6, true, 1),

  ('triangle-down', 'breath',
   '{"ru":"Треугольник вершиной вниз","en":"Triangle (apex down)"}',
   '{"ru":"Висама-Вритти · Антар Кумбхака: вдох-задержка-выдох.","en":"Vishama Vritti with post-inhalation retention."}',
   360, 120, 900,
   '{"indicatorKind":"triangle-down","channelMode":"both","normalBaseBeats":5,"minBaseBeats":1,"maxBaseBeats":10}',
   0.6, true, 1)
on conflict (slug) do update set
  title                 = excluded.title,
  description           = excluded.description,
  default_duration_sec  = excluded.default_duration_sec,
  min_duration_sec      = excluded.min_duration_sec,
  max_duration_sec      = excluded.max_duration_sec,
  params                = excluded.params,
  rating                = excluded.rating,
  is_active             = excluded.is_active,
  updated_at            = now();

-- =============================================================================
-- Маппинг практика → чакра (первичная + вторичные).
-- Первичные цвета — для быстрых рекомендаций; вторичные — для расширенного
-- подбора по запросу LLM/алгоритма.
-- Если захотите скорректировать связи — правьте здесь или через админку.
-- =============================================================================

-- Удаляем старые связи по слагу, чтобы правки подхватились при повторном seed
delete from public.practice_chakras
  where practice_id in (
    select id from public.practices
    where slug in ('coherent','nadi-shodhana','surya-bhedana',
                   'chandra-bhedana','square','triangle-up','triangle-down')
  );

insert into public.practice_chakras (practice_id, chakra_id, is_primary, weight)
select p.id, v.chakra_id, v.is_primary, v.weight
from (values
  -- coherent: сердечный резонанс + корона
  ('coherent',        4::smallint, true,  1.0::numeric),
  ('coherent',        7::smallint, false, 0.5),
  -- nadi-shodhana: аджна (баланс полушарий), плюс сердечная
  ('nadi-shodhana',   6::smallint, true,  1.0),
  ('nadi-shodhana',   4::smallint, false, 0.5),
  -- surya-bhedana: манипура (огонь/активация)
  ('surya-bhedana',   3::smallint, true,  1.0),
  ('surya-bhedana',   1::smallint, false, 0.4),
  -- chandra-bhedana: свадхистана (охлаждение), аджна (интуиция)
  ('chandra-bhedana', 2::smallint, true,  1.0),
  ('chandra-bhedana', 6::smallint, false, 0.5),
  -- square: муладхара (стабильность)
  ('square',          1::smallint, true,  1.0),
  ('square',          3::smallint, false, 0.4),
  -- triangle-up: вишуддха (выражение, пауза в пустоте)
  ('triangle-up',     5::smallint, true,  1.0),
  ('triangle-up',     4::smallint, false, 0.5),
  -- triangle-down: анахата (наполнение, пауза после вдоха)
  ('triangle-down',   4::smallint, true,  1.0),
  ('triangle-down',   5::smallint, false, 0.5)
) as v(slug, chakra_id, is_primary, weight)
join public.practices p on p.slug = v.slug
on conflict (practice_id, chakra_id) do nothing;

-- =============================================================================
-- M3/M4: управляемые промпты и реестр фаз Orchestrator-Driven Dialogue.
-- =============================================================================

insert into public.prompts
  (prompt_key, prompt_type, use_case, version, is_active, template, variables, model_hint, temperature, max_output_tokens, response_format, notes)
values
  (
    'calibration_extraction', 'extraction', 'calibration', 1, true,
$prompt$СИСТЕМНАЯ РОЛЬ:
Ты — анализатор обратной связи пользователя для калибровки психологической модели Harmonizer. У пользователя есть оценки силы S (0..1) и гармоничности H (-1..+1) семи чакр-планет. На основе слов пользователя:

1. Для каждой явно упомянутой или подразумеваемой планеты предложи дельты dS и dH в диапазоне -0.30..+0.30. Если данных нет — dS=0, dH=0, confirmed=false.
2. Верни подтвержденные, отвергнутые и добавленные состояния, а также личные фразы пользователя.
3. Не разгоняй дельты: "у меня нет проблем" = мягкая положительная коррекция, а не максимум.
4. Не выдумывай то, чего пользователь не сказал.

ФОРМАТ ОТВЕТА: строгий JSON, без markdown:
{
  "deltas": {
    "Sun": {"dS": 0, "dH": 0, "confirmed": false},
    "Moon": {"dS": 0, "dH": 0, "confirmed": false},
    "Mercury": {"dS": 0, "dH": 0, "confirmed": false},
    "Venus": {"dS": 0, "dH": 0, "confirmed": false},
    "Mars": {"dS": 0, "dH": 0, "confirmed": false},
    "Jupiter": {"dS": 0, "dH": 0, "confirmed": false},
    "Saturn": {"dS": 0, "dH": 0, "confirmed": false}
  },
  "vocabulary": {
    "Sun": {"confirmedStates": [], "rejectedStates": [], "addedStates": [], "personalPhrases": []},
    "Moon": {"confirmedStates": [], "rejectedStates": [], "addedStates": [], "personalPhrases": []},
    "Mercury": {"confirmedStates": [], "rejectedStates": [], "addedStates": [], "personalPhrases": []},
    "Venus": {"confirmedStates": [], "rejectedStates": [], "addedStates": [], "personalPhrases": []},
    "Mars": {"confirmedStates": [], "rejectedStates": [], "addedStates": [], "personalPhrases": []},
    "Jupiter": {"confirmedStates": [], "rejectedStates": [], "addedStates": [], "personalPhrases": []},
    "Saturn": {"confirmedStates": [], "rejectedStates": [], "addedStates": [], "personalPhrases": []}
  }
}

ВХОД:
Натальный профиль: {{natal_profile_json}}
Базовые состояния: {{baseline_states_json}}
Текст пользователя или digest диалогов: {{user_feedback_text}}
Предыдущая калибровка: {{previous_calibration_json}}
Язык: {{language}}$prompt$,
    '{"natal_profile_json":{"required":true},"baseline_states_json":{"required":true},"user_feedback_text":{"required":true},"previous_calibration_json":{"required":false},"language":{"required":false}}'::jsonb,
    'gemini-2.5-flash', 0.4, 1500, 'json_object',
    'M3: извлечение дельт, states_map и user_lexicon из обратной связи.'
  ),
  (
    'orchestrator_decision', 'orchestrator', null, 1, true,
$prompt$Ты — оркестратор диалога в приложении психологической гармонизации. Ты не общаешься с пользователем напрямую. Твоя задача — решить, какая фаза должна быть следующей.

ТЕКУЩИЙ USE CASE: {{use_case}}
ДОСТУПНЫЕ ФАЗЫ:
{{available_phases}}
ОСИ ИНФОРМАЦИИ:
{{information_axes}}
ВРЕМЯ СУТОК: {{time_of_day}} ({{local_hour}}:00), подсказка: {{time_of_day_hint}}
НОМЕР ИТЕРАЦИИ: {{iteration_number}} (soft cap: {{soft_cap}})
ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ:
{{user_profile_summary}}
ИСТОРИЯ:
{{conversation_history}}
ПОСЛЕДНЕЕ СООБЩЕНИЕ:
{{user_message}}

Правила:
- Если сообщение плотное и конкретное, не затягивай уточнения.
- В daily_dialog инсайт должен предшествовать предложению практики.
- Если пользователь готов действовать, переходи к ask_practice_intent или suggest_practice.
- Если soft cap близко исчерпан, мягко веди к завершению.

ФОРМАТ: строгий JSON:
{
  "next_phase": "...",
  "reasoning": "1-2 предложения",
  "information_completeness": {},
  "information_density": 0.0,
  "user_signals": [],
  "should_close": false,
  "close_reason": null,
  "responder_hints": {"tone": "warm", "use_user_phrases": [], "avoid_topics": []}
}$prompt$,
    '{"use_case":{"required":true},"available_phases":{"required":true},"information_axes":{"required":true},"time_of_day":{"required":true},"local_hour":{"required":true},"time_of_day_hint":{"required":true},"iteration_number":{"required":true},"soft_cap":{"required":true},"user_profile_summary":{"required":true},"conversation_history":{"required":true},"user_message":{"required":true}}'::jsonb,
    'gemini-2.5-flash', 0.3, 512, 'json_object',
    'M4: мета-LLM для выбора следующей фазы диалога.'
  ),
  (
    'responder_main', 'system', null, 1, true,
$prompt$Ты — эмпатичный помощник Harmonizer: внимательный психолог-наставник и проводник к мягкой практике.

Принципы:
- Говори о состояниях, теле, делах и отношениях на бытовом языке.
- Не упоминай астрологию, чакры, аспекты и транзиты, если пользователь сам не спросил.
- Каждое сообщение — 1-3 коротких предложения.
- Перед практикой сначала дай психологический инсайт: связь между состоянием пользователя и темой дня.

ТЕКУЩАЯ ФАЗА: {{current_phase}}
ИНСТРУКЦИЯ ФАЗЫ:
{{phase_instruction}}
ТОН: {{tone}}
СТИЛЬ ПОЛЬЗОВАТЕЛЯ: {{style_markers}}
ФРАЗЫ ПОЛЬЗОВАТЕЛЯ: {{user_phrases}}
ПОДСКАЗКИ ОРКЕСТРАТОРА:
- использовать фразы: {{use_user_phrases}}
- избегать тем: {{avoid_topics}}
ПРОФИЛЬ:
{{user_profile_summary}}
КОНТЕКСТ ДНЯ:
{{daily_context}}

Ответь пользователю в фазе {{current_phase}}.$prompt$,
    '{"current_phase":{"required":true},"phase_instruction":{"required":true},"tone":{"required":false},"style_markers":{"required":false},"user_phrases":{"required":false},"use_user_phrases":{"required":false},"avoid_topics":{"required":false},"user_profile_summary":{"required":true},"daily_context":{"required":false}}'::jsonb,
    'gemini-2.5-flash', 0.7, 400, 'text',
    'M4: основной responder, следует решению оркестратора.'
  )
on conflict (prompt_key, version) do update set
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

insert into public.prompts
  (prompt_key, prompt_type, use_case, version, is_active, template, variables, model_hint, temperature, max_output_tokens, response_format, notes)
values
  ('phase_welcome_and_hint', 'phase', 'calibration', 1, true,
$prompt$Поприветствуй ({{time_of_day_greeting}}) и кратко объясни, что ты рад уточнить портрет. Предложи нажать микрофон и рассказать: что попало точно, что не так, что хочется добавить. Сохрани мысль: это не редактирование текста, а перестройка фундамента, из которого описание получилось.$prompt$,
    '{}'::jsonb, 'gemini-2.5-flash', 0.7, 250, 'text', 'Фаза калибровки: приветствие.'),
  ('phase_listen_user', 'phase', 'calibration', 1, true,
$prompt$[silent phase, нет ответа]$prompt$,
    '{}'::jsonb, null, 0, 0, 'text', 'Служебная фаза: пользователь говорит.'),
  ('phase_deepen_specific_chakra', 'phase', 'calibration', 1, true,
$prompt$Оркестратор определил, что одна тема не до конца ясна: {{focus_chakra_label}}. Задай один короткий вопрос про это состояние на бытовом языке, не упоминая чакру или планету.$prompt$,
    '{}'::jsonb, 'gemini-2.5-flash', 0.7, 200, 'text', 'Фаза калибровки: уточнение.'),
  ('phase_acknowledge_and_close', 'phase', 'calibration', 1, true,
$prompt$Поблагодари пользователя по сути его ответов и заверши фразой: "Благодарю! Карта твоих внутренних сил скорректирована. Ты можешь найти её в настройках и провести калибровку снова в любой момент."$prompt$,
    '{}'::jsonb, 'gemini-2.5-flash', 0.6, 250, 'text', 'Фаза калибровки: закрытие.'),
  ('phase_contextual_greeting', 'phase', 'daily_dialog', 1, true,
$prompt$Поприветствуй с учетом времени суток: {{time_of_day_greeting}}. Коротко отзеркаль источник входа {{entry_source}} и спроси о текущем состоянии с учетом времени дня.$prompt$,
    '{}'::jsonb, 'gemini-2.5-flash', 0.8, 200, 'text', 'Daily dialogue: приветствие.'),
  ('phase_collect_state', 'phase', 'daily_dialog', 1, true,
$prompt$Узнай, что с пользователем сейчас. Если он уже сказал о состоянии, не переспрашивай. Можно предложить 4-5 коротких вариантов из сегодняшних состояний: {{today_states_options}}.$prompt$,
    '{}'::jsonb, 'gemini-2.5-flash', 0.7, 250, 'text', 'Daily dialogue: сбор состояния.'),
  ('phase_deepen_inquiry', 'phase', 'daily_dialog', 1, true,
$prompt$Информации мало. Задай один теплый открытый вопрос по оси {{deepen_axis}}. Не интерпретируй и не учи.$prompt$,
    '{}'::jsonb, 'gemini-2.5-flash', 0.7, 200, 'text', 'Daily dialogue: углубление.'),
  ('phase_offer_insight', 'phase', 'daily_dialog', 1, true,
$prompt$Дай один психологический инсайт о связи состояния пользователя с темой дня. Тема дня: {{planet_of_day_summary}}. Состояние пользователя: {{user_current_state_summary}}. Инсайт должен предшествовать практике и завершаться коротким вопросом: "Откликается?"$prompt$,
    '{}'::jsonb, 'gemini-2.5-flash', 0.7, 350, 'text', 'Daily dialogue: инсайт перед практикой.'),
  ('phase_ask_practice_intent', 'phase', 'daily_dialog', 1, true,
$prompt$Спроси, сколько у пользователя есть времени (5/10/20/30+ минут) и какой тип практики ближе сейчас: медитация, пранаяма или асаны. Адаптируй тон к {{tone}}.$prompt$,
    '{}'::jsonb, 'gemini-2.5-flash', 0.7, 200, 'text', 'Daily dialogue: намерение практики.'),
  ('phase_suggest_practice', 'phase', 'daily_dialog', 1, true,
$prompt$Из списка {{filtered_practices_list}} выбери одну практику и объясни в двух предложениях, почему она подходит сейчас. В конце добавь маркер [PRACTICE_PICK: id="..." reason="..."].$prompt$,
    '{}'::jsonb, 'gemini-2.5-flash', 0.7, 300, 'text', 'Daily dialogue: предложение практики.'),
  ('phase_confirm_and_close', 'phase', 'daily_dialog', 1, true,
$prompt$Подтверди выбор практики и дай короткое теплое напутствие в стиле пользователя. Если диалог меняет дневную рекомендацию, добавь маркер [CORRECT_RECOMMENDATION: short_text="..." windows_correction="..."].$prompt$,
    '{}'::jsonb, 'gemini-2.5-flash', 0.6, 250, 'text', 'Daily dialogue: закрытие.')
on conflict (prompt_key, version) do update set
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

insert into public.dialogue_phases
  (use_case, phase_id, prompt_key, is_terminal, is_silent, description, display_order)
values
  ('calibration', 'welcome_and_hint', 'phase_welcome_and_hint', false, false, 'Приветствие и инструкция к калибровке', 1),
  ('calibration', 'listen_user', 'phase_listen_user', false, true, 'Служебная фаза записи обратной связи', 2),
  ('calibration', 'deepen_specific_chakra', 'phase_deepen_specific_chakra', false, false, 'Уточнение по конкретной теме', 3),
  ('calibration', 'acknowledge_and_close', 'phase_acknowledge_and_close', true, false, 'Благодарность и закрытие калибровки', 4),
  ('daily_dialog', 'contextual_greeting', 'phase_contextual_greeting', false, false, 'Контекстное приветствие', 1),
  ('daily_dialog', 'collect_state', 'phase_collect_state', false, false, 'Сбор текущего состояния', 2),
  ('daily_dialog', 'deepen_inquiry', 'phase_deepen_inquiry', false, false, 'Уточняющий вопрос', 3),
  ('daily_dialog', 'offer_insight', 'phase_offer_insight', false, false, 'Психологический инсайт перед практикой', 4),
  ('daily_dialog', 'ask_practice_intent', 'phase_ask_practice_intent', false, false, 'Уточнение времени и типа практики', 5),
  ('daily_dialog', 'suggest_practice', 'phase_suggest_practice', false, false, 'Предложение конкретной практики', 6),
  ('daily_dialog', 'confirm_and_close', 'phase_confirm_and_close', true, false, 'Подтверждение и завершение', 7)
on conflict (use_case, phase_id) do update set
  prompt_key = excluded.prompt_key,
  is_terminal = excluded.is_terminal,
  is_silent = excluded.is_silent,
  description = excluded.description,
  display_order = excluded.display_order,
  is_active = true;
