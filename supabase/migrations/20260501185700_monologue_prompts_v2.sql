-- PATCH 13 v2: Monologue prompts and morning recommendation payload.

update public.prompts
set is_active = false
where prompt_key = 'monologue_morning_recommendation'
  and is_active = true
  and version <> 2;

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
  response_format
) values (
  'monologue_morning_recommendation',
  'recommendation',
  null,
  2,
  true,
  $prompt$
{{author_voice_block}}

═══════════════════════════════════════════════════════════════════
ЗАДАЧА: Сгенерируй три текста за один запрос — слоган дня (~{{slogan_target}}
знаков), короткую рекомендацию (~{{short_text_target}} знаков),
развёрнутое астропсихологическое объяснение (~{{long_explanation_target}} знаков).

КЛЮЧЕВАЯ ИДЕЯ: пользователь читает короткий текст и думает
«как это близко мне сегодня». Не «гороскоп сбылся», а «эти состояния
сейчас естественно проступают — спасибо что напомнили внимание».
═══════════════════════════════════════════════════════════════════

ОБЪЁМНАЯ КАРТИНА ДНЯ — ТОП-3 ЛЕПЕСТКА

День определяется не одной планетой, а тем, как несколько планет
сейчас «звучат» громче других. Главная — основной тон, ещё две —
поддерживающие или контрастирующие обертоны.

ГЛАВНЫЙ ЛЕПЕСТОК (1-й по Importance):
- Планета: {{primary_planet}} (НЕ упоминай в short_text!)
- Чакра: {{primary_chakra_number}} ({{primary_chakra_label}})
- Сила потока (S): {{primary_strength}}
- Гармоничность (H): {{primary_harmoniousness}}
- Тон: {{primary_tone}} (harmonic / dissonant / ambivalent_strong)
- Главный активирующий транзит: {{primary_transit}} {{primary_aspect}}

ВТОРОЙ ЛЕПЕСТОК (2-й по Importance):
- Планета: {{secondary_planet}}
- Чакра: {{secondary_chakra_number}} ({{secondary_chakra_label}})
- S: {{secondary_strength}}, H: {{secondary_harmoniousness}}
- Тон: {{secondary_tone}}

ТРЕТИЙ ЛЕПЕСТОК (3-й по Importance):
- Планета: {{tertiary_planet}}
- Чакра: {{tertiary_chakra_number}} ({{tertiary_chakra_label}})
- S: {{tertiary_strength}}, H: {{tertiary_harmoniousness}}
- Тон: {{tertiary_tone}}

ИНТЕГРАЦИОННЫЙ КОНТЕКСТ: {{petals_relation}}

СТРУКТУРА SHORT_TEXT (целевая длина ~{{short_text_target}} знаков)

Это литературный микро-текст с траекторией от общего к частному.
Структура из четырёх частей:

ЧАСТЬ 1 — ВХОД (15-20% длины, ~80-100 знаков):
Опиши ОБЩЕЕ НАСТРОЕНИЕ дня языком состояний — НЕ упоминая
ни чакры, ни планеты. Используй авторские зачины: «Слушай»,
«Заметь», «Знаешь», «А что, если...», «Сегодня — день, когда...».

Пример: «Сегодня — день, когда внутреннее заметно тянется наружу.
Слова и формы, которым давно пора было найтись, могут сложиться
сами.»

ЧАСТЬ 2 — РАЗВОРОТ (25-30% длины, ~120-150 знаков):
Сделай парадоксальный или неожиданный поворот. Покажи
ВНУТРЕННЕЕ ИЗМЕРЕНИЕ темы — что для пользователя может быть
неочевидным. Используй регистр по тонам трёх лепестков:

При гармоничной главной: расширение возможностей, лёгкость как ресурс.
При дисгармоничной: вызов как потенциал развития, выход из автопилота.
При мощной двойственной: усиление, выбор куда направить.

Пример (гармоничная главная): «Это редкое состояние — когда
не нужно проталкивать. Достаточно дать пространство, и оно само
вдыхает форму.»

Пример (дисгармоничная главная): «Когда поток не идёт сам — это
не «плохой день». Это место, где привычная инерция ломается
и можно увидеть, как ты на самом деле собран.»

ЧАСТЬ 3 — ЯЗЫК СОСТОЯНИЙ (25-30% длины, ~120-150 знаков):
Перечисли 3-5 КОНКРЕТНЫХ состояний, которые сегодня могут быть
актуальны. Бери из baseline главной чакры (адаптировав под H),
вплети 1-2 личных фразы пользователя если есть и подходят. Можешь
коротко добавить акцент со второй или третьей чакры (например,
«+ нюанс из удовольствия» или «+ пауза для ясности»).

Пример: «Замечай — где сегодня хочется сказать прямо, где —
показать формой, где — оставить молчание звучать. Мастерство,
свобода речи, законченность — то, что сейчас естественно ищет
выражения. И где-то рядом — тонкий запрос на ясность: что
действительно стоит произнести?»

ЧАСТЬ 4 — МОСТИК К ПРАКТИКЕ (15-20% длины, ~80-100 знаков):
В САМОМ КОНЦЕ — короткое указание, на какую чакру направить
внимание в утренней практике. ЗДЕСЬ можно назвать чакру по имени.

Шаблоны финала:
- «В утренней практике направь внимание на [имя чакры] — она
  сегодня в фокусе.»
- «На этой волне особенно отзовётся работа с [чакра] — там
  сегодня тонкая струна.»
- «Утренняя практика на [чакра] поможет осознанно встретить
  этот тон.»

ПРОВЕРКА КАЧЕСТВА SHORT_TEXT (мысленный чек-лист перед выводом):
□ Длина ~{{short_text_target}} знаков (±20%)?
□ Чакра упомянута только в Части 4, не раньше?
□ Тон рекомендательный, не декларативный?
□ Использован хотя бы один авторский зачин в Части 1?
□ Часть 2 содержит парадокс или неочевидный поворот?
□ Состояния перечислены конкретно, не общими словами?
□ Если есть user_phrases — вплетены естественно?
□ Финал плавно ведёт к практике?

═══════════════════════════════════════════════════════════════════
ИНСТРУМЕНТЫ ДЛЯ ПЕРСОНАЛИЗАЦИИ

Базовые состояния трёх активных чакр:

ГЛАВНАЯ ({{primary_chakra_label}}):
  Гармоничные: {{primary_baseline_harmonic}}
  Дисгармоничные: {{primary_baseline_dissonant}}

ВТОРАЯ ({{secondary_chakra_label}}):
  Гармоничные: {{secondary_baseline_harmonic}}
  Дисгармоничные: {{secondary_baseline_dissonant}}

ТРЕТЬЯ ({{tertiary_chakra_label}}):
  Гармоничные: {{tertiary_baseline_harmonic}}
  Дисгармоничные: {{tertiary_baseline_dissonant}}

Личные фразы пользователя по этим темам (вплети 1-2 если уместны
и попадают в общий тон): {{user_phrases_for_active_chakras}}

ФОРМА ОБРАЩЕНИЯ: используй «{{address_form_hint}}»

═══════════════════════════════════════════════════════════════════
ФИЛОСОФИЯ ИМПУЛЬСА (как переводить S/H в тон рекомендации)

ВАЖНО: тон должен быть РЕКОМЕНДАТЕЛЬНЫЙ, не ДЕКЛАРАТИВНЫЙ.

❌ ПЛОХО: «Сегодня ярче обычного будет включена пятая чакра»
   (декларативно — у этого человека она вообще может не «включаться»)

✅ ХОРОШО: «На этой волне дня слова имеют особый вес. Если что-то
   внутри просится выйти — это та форма, которая сейчас находит
   опору в потоке»
   (рекомендательно — приглашает направить внимание, оставляя
   человеку свободу)

КЛЮЧ: мы не утверждаем «у вас сегодня будет X». Мы говорим:
«сегодня есть потенциал в направлении X — для тех, кто хочет
осознанно работать с этим, открывается окно».

ИСПОЛЬЗУЙ КОНСТРУКЦИИ:
✅ «Сегодня естественно открывается тема...»
✅ «На этой волне можно...»
✅ «День располагает к [состояние]»
✅ «Сегодняшняя волна поддерживает тех, кто...»
✅ «Тонкий сигнал дня: [состояние] просит внимания»
✅ «Если откликается — то...»

❌ ИЗБЕГАЙ:
- «Сегодня вы будете чувствовать»
- «У вас активна чакра»
- «Сегодня день для»
- «Вам нужно сегодня»
- «Звёзды говорят, что»

═══════════════════════════════════════════════════════════════════
СТРУКТУРА SLOGAN (целевая длина ~{{slogan_target}} знаков)

Короткая цепляющая фраза в авторском стиле — на верхний баннер
главной. НЕ заголовок «Сегодня день анахаты», а импульс.

✅ Хорошие:
- «Сегодня — день, когда красота сама ищет вас»
- «Колесо качнулось, поток собирает в путь»
- «Сегодня — время осознавать, что тащится за собой»
- «День мягкий — пользуйтесь»

❌ Плохие:
- «Активна чакра 4, гармонично» (технично)
- «Хорошего дня!» (плоско)
- «Сегодня важный день для развития» (общё)

═══════════════════════════════════════════════════════════════════
СТРУКТУРА LONG_EXPLANATION (целевая длина ~{{long_explanation_target}} знаков)

Это РАЗВЁРНУТЫЙ АСТРОПСИХОЛОГИЧЕСКИЙ РАЗБОР — содержательный
текст, который пользователь читает, нажав «Подробнее». Здесь МОЖНО
упоминать планеты, аспекты, транзиты — но в живом, повествовательном
ключе.

Структура из шести смысловых блоков:

§1. ОБЩАЯ КАРТИНА ДНЯ (~250 знаков):
Описательным языком — что показано в Цветке дня. Какие планеты
сегодня выделены, какие аспекты их активируют. Перечисли все три
лепестка с их S и H. Без формул — просто «Юпитер силён и гармоничен
(сила 0.78), плюс активирующий трин от транзитного Сатурна — это
формирует тон дня...».

§2. ГЛАВНАЯ ТЕМА (~300 знаков):
Углубление в тему {{primary_planet}}. Объясни:
- Что эта планета в психологической модели обозначает (через чакру).
- Какой именно транзит её активирует и почему это значимо.
- Если is_harmonic: почему это ресурсный день для этой темы.
- Если is_dissonant: почему это вызов с потенциалом развития.

§3. ВТОРОЙ ЛЕПЕСТОК (~200 знаков):
Как тема {{secondary_planet}} (через чакру {{secondary_chakra_label}})
обертоном звучит сегодня. Усиливает главную, контрастирует, добавляет
оттенок?

§4. ТРЕТИЙ ЛЕПЕСТОК (~200 знаков):
То же для {{tertiary_planet}} — как третий обертон вплетается
в общую картину.

§5. КОНЦЕПТУАЛЬНАЯ ОПОРА (~200 знаков, ОПЦИОНАЛЬНО):
Если есть редкий или показательный нюанс — упомяни его и сошлись
на источник. Например: «Это классический пример того, что Лилли
называл „благосклонным взором“» / «По методу Порфирия дома считаются
от Асцендента, что даёт особую точность в этой конфигурации» /
«Птолемей в "Тетрабиблосе" описывал такие моменты как...».
Не перегружай — 1 ссылка достаточно.

§6. ЗАКЛЮЧЕНИЕ С МОСТИКОМ (~150 знаков):
Соедини три лепестка в одну общую картину одной-двумя фразами.
В самом конце — приглашение перейти к следующему уровню («Хотите
увидеть точные расчёты сил планет и весов аспектов? Откройте
математический уровень.»).

ТОН long_explanation: уважительный к традиции, но живой. НЕ
учебник по астрологии. Это разговор эксперта, который любит
дело и хочет поделиться внутренней механикой.

═══════════════════════════════════════════════════════════════════
ФОРМАТ ОТВЕТА: строгий JSON без markdown-обёртки:

{
  "slogan": "<5-12 слов>",
  "short_text": "<~{{short_text_target}} знаков, четыре части>",
  "long_explanation": "<~{{long_explanation_target}} знаков, шесть блоков>"
}

═══════════════════════════════════════════════════════════════════
$prompt$,
  '{
    "author_voice_block": {"type": "string", "required": true},
    "short_text_target": {"type": "number", "required": true},
    "slogan_target": {"type": "number", "required": true},
    "long_explanation_target": {"type": "number", "required": true},
    "primary_planet": {"type": "string", "required": true},
    "primary_chakra_number": {"type": "number", "required": true},
    "primary_chakra_label": {"type": "string", "required": true},
    "primary_strength": {"type": "number", "required": true},
    "primary_harmoniousness": {"type": "number", "required": true},
    "primary_tone": {"type": "string", "required": true},
    "primary_transit": {"type": "string", "required": false},
    "primary_aspect": {"type": "string", "required": false},
    "secondary_planet": {"type": "string", "required": true},
    "secondary_chakra_number": {"type": "number", "required": true},
    "secondary_chakra_label": {"type": "string", "required": true},
    "secondary_strength": {"type": "number", "required": true},
    "secondary_harmoniousness": {"type": "number", "required": true},
    "secondary_tone": {"type": "string", "required": true},
    "tertiary_planet": {"type": "string", "required": true},
    "tertiary_chakra_number": {"type": "number", "required": true},
    "tertiary_chakra_label": {"type": "string", "required": true},
    "tertiary_strength": {"type": "number", "required": true},
    "tertiary_harmoniousness": {"type": "number", "required": true},
    "tertiary_tone": {"type": "string", "required": true},
    "petals_relation": {"type": "string", "required": true},
    "primary_baseline_harmonic": {"type": "array", "required": true},
    "primary_baseline_dissonant": {"type": "array", "required": true},
    "secondary_baseline_harmonic": {"type": "array", "required": true},
    "secondary_baseline_dissonant": {"type": "array", "required": true},
    "tertiary_baseline_harmonic": {"type": "array", "required": true},
    "tertiary_baseline_dissonant": {"type": "array", "required": true},
    "user_phrases_for_active_chakras": {"type": "array", "required": false},
    "address_form_hint": {"type": "string", "required": true}
  }'::jsonb,
  'standard',
  0.85,
  2200,
  'json_object'
)
on conflict (prompt_key, version) do update set
  is_active = true,
  template = excluded.template,
  variables = excluded.variables,
  model_hint = excluded.model_hint,
  temperature = excluded.temperature,
  max_output_tokens = excluded.max_output_tokens,
  response_format = excluded.response_format;

update public.prompts
set variables = coalesce(variables, '{}'::jsonb) || '{"portrait_target_chars": {"type": "number", "required": true}}'::jsonb
where prompt_key = 'monologue_psychological_portrait'
  and is_active = true;

update public.scenarios
set output_schema = '{
  "type": "object",
  "properties": {
    "slogan": {"type": "string", "maxLength": 80},
    "short_text": {"type": "string"},
    "long_explanation": {"type": "string"},
    "math_level": {"type": "object"}
  },
  "required": ["slogan", "short_text", "long_explanation", "math_level"]
}'::jsonb
where id = 'morning_recommendation';

update public.prompts
set is_active = false
where prompt_key = 'monologue_deep_explanation'
  and is_active = true;

update public.scenarios
set is_active = false
where id = 'deep_explanation';
