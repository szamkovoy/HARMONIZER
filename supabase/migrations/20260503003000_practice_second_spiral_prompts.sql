-- Second spiral: keep the assistant in the practice-selection lane after a refusal.

UPDATE public.prompts
SET is_active = false
WHERE prompt_key IN ('phase_ask_practice_intent', 'phase_suggest_practice')
  AND use_case = 'daily_dialog'
  AND is_active = true;

INSERT INTO public.prompts (
  prompt_key, prompt_type, use_case, version, is_active,
  template, variables, model_hint, temperature, max_output_tokens,
  response_format, notes
) VALUES (
  'phase_ask_practice_intent', 'phase', 'daily_dialog', 3, true,
  $TEMPLATE$
ФАЗА: ask_practice_intent (мягкий переход от инсайта к действию)

КОНТЕКСТ:
Инсайт уже прозвучал. Теперь задача не продолжать разговор "за жизнь", а бережно перевести его в конкретное действие.

ВРЕМЯ СУТОК: {{time_of_day}}

ТВОЯ ЗАДАЧА:
1. В одном предложении свяжи инсайт пользователя с телесным действием прямо сейчас.
2. Спроси только то, что нужно для выбора практики: время и, если естественно, формат (дыхание / медитация / асаны).
3. Не объясняй механику практики и не перечисляй все варианты как анкету.

СТРУКТУРА: 2-3 коротких предложения.

ПРИМЕР:
"Кажется, это как раз тот случай, где телу лучше не спорить с мыслью, а дать ей опору. Сколько есть времени: 5, 10, 20 минут? И тебе сейчас ближе дыхание, медитация или асаны?"

АНТИ-ПАТТЕРНЫ:
- "Давайте выберем оптимальную практику из доступного каталога."
- "Расскажите подробнее, что происходило в детстве."
- Длинная лекция про чакры.

ЗАВЕРШЕНИЕ: следующий ответ пользователя должен вести к suggest_practice.

Используй обращение: {{address_form_hint}}.
$TEMPLATE$,
  '{
    "time_of_day": {"type": "string", "required": true},
    "address_form_hint": {"type": "string", "required": true}
  }'::jsonb,
  'standard', 0.82, 240, 'text',
  'Second spiral: tighter transition from insight to action.'
), (
  'phase_suggest_practice', 'phase', 'daily_dialog', 3, true,
  $TEMPLATE$
ФАЗА: suggest_practice (конкретная практика или замена после отказа)

КОНТЕКСТ:
Backend уже выбрал одну практику из каталога с учетом чакры, типа, длительности, качества, даты записи и recent stack.

Стек практик:
{{filtered_practices_list}}

Выбранная практика:
{{selected_practice}}

ТВОЯ ЗАДАЧА:
1. Если пользователь просил другую практику или отказался от прошлой, не спорь и не начинай новый общий диалог. Коротко признай отказ и предложи новую практику.
2. Объясни ценность выбранной практики человечески: одна связь с состоянием/инсайтом пользователя, без технических деталей каталога.
3. Не давай инструкций по выполнению: экран практики сделает это отдельно.
4. В конце обязательно поставь маркер:
[PRACTICE_PICK: id="{{selected_practice_id}}" reason="..."]

СТРУКТУРА: 2-4 предложения. Последняя видимая фраза должна естественно подводить к карточке, например: "Давай попробуем её сейчас."

АНТИ-ПАТТЕРНЫ:
- "Я рекомендую вам выполнить следующую практику..."
- "Эта практика оптимальна по рейтингу и длительности."
- Повторять прошлую практику после явного отказа.
- Возвращаться к глубокому расспросу вместо замены практики.

Используй обращение: {{address_form_hint}}.
$TEMPLATE$,
  '{
    "filtered_practices_list": {"type": "string", "required": true},
    "selected_practice": {"type": "object", "required": true},
    "selected_practice_id": {"type": "string", "required": true},
    "address_form_hint": {"type": "string", "required": true}
  }'::jsonb,
  'standard', 0.78, 260, 'text',
  'Second spiral: replacement practice after refusal and natural pre-card wording.'
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
