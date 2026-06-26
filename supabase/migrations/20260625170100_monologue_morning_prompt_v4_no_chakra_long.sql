-- monologue_morning_recommendation v4:
-- - long_explanation: avoid chakra scaffolding; if chakras appear, use numeric labels only

update public.prompts
set is_active = false
where prompt_key = 'monologue_morning_recommendation'
  and is_active = true
  and version <> 4;

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
  4,
  true,
  replace(
    replace(
      replace(
        replace(
          template,
          $old2$§2. ГЛАВНАЯ ТЕМА (~300 знаков):
Углубление в тему {{primary_planet}}. Объясни:
- Что эта планета в психологической модели обозначает (через чакру).
- Какой именно транзит её активирует и почему это значимо.
- Если is_harmonic: почему это ресурсный день для этой темы.
- Если is_dissonant: почему это вызов с потенциалом развития.$old2$,
          $new2$§2. ГЛАВНАЯ ТЕМА (~300 знаков):
Углубление в тему {{primary_planet}}. Объясни:
- Какую психологическую тему эта планета несёт сегодня.
- Какой именно транзит её активирует и почему это значимо.
- Если is_harmonic: почему это ресурсный день для этой темы.
- Если is_dissonant: почему это вызов с потенциалом развития.

Если упоминаешь чакру, используй ТОЛЬКО номерное название:
«первая чакра», «третья чакра», «четвёртая чакра» и т.д. Нельзя
использовать санскритские имена чакр.$new2$
        ),
        $old3$§3. ВТОРОЙ ЛЕПЕСТОК (~200 знаков):
Как тема {{secondary_planet}} (через чакру {{secondary_chakra_label}})
обертоном звучит сегодня. Усиливает главную, контрастирует, добавляет
оттенок?$old3$,
        $new3$§3. ВТОРОЙ ЛЕПЕСТОК (~200 знаков):
Как тема {{secondary_planet}} обертоном звучит сегодня. Усиливает главную,
контрастирует, добавляет оттенок? Без упоминания чакр.$new3$
      ),
      $old4$§4. ТРЕТИЙ ЛЕПЕСТОК (~200 знаков):
То же для {{tertiary_planet}} — как третий обертон вплетается
в общую картину.$old4$,
      $new4$§4. ТРЕТИЙ ЛЕПЕСТОК (~200 знаков):
То же для {{tertiary_planet}} — как третий обертон вплетается
в общую картину. Без упоминания чакр.$new4$
    ),
    $old_tone$ТОН long_explanation: уважительный к традиции, но живой. НЕ
учебник по астрологии. Это разговор эксперта, который любит
дело и хочет поделиться внутренней механикой.$old_tone$,
    $new_tone$ТОН long_explanation: уважительный к традиции, но живой. НЕ
учебник по астрологии. Это разговор эксперта, который любит
дело и хочет поделиться внутренней механикой.

Если в long_explanation всё же упоминаются чакры, допустимы только номерные
названия вида «четвёртая чакра», «третья чакра», «седьмая чакра».
Запрещены санскритские имена чакр, а также конструкции вроде «планета в
Анахате», «энергия Манипуры», «раскрытие Сахасрары».$new_tone$
  ),
  variables,
  model_hint,
  temperature,
  max_output_tokens,
  response_format,
  'PATCH: long_explanation may mention chakras only by numeric labels; no Sanskrit chakra names.'
from public.prompts
where prompt_key = 'monologue_morning_recommendation'
  and version = 3
on conflict (prompt_key, version) do update set
  is_active = excluded.is_active,
  template = excluded.template,
  variables = excluded.variables,
  model_hint = excluded.model_hint,
  temperature = excluded.temperature,
  max_output_tokens = excluded.max_output_tokens,
  response_format = excluded.response_format,
  notes = excluded.notes;
