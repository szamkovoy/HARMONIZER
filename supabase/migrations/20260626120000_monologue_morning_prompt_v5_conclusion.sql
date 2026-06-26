-- monologue_morning_recommendation v5:
-- - section 6 heading: "ЗАКЛЮЧЕНИЕ" without "С МОСТИКОМ"
-- - forbid English technical tone keys in visible JSON output

update public.prompts
set is_active = false
where prompt_key = 'monologue_morning_recommendation'
  and is_active = true
  and version <> 5;

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
  5,
  true,
  replace(
    replace(
      template,
      $old6$§6. ЗАКЛЮЧЕНИЕ С МОСТИКОМ (~150 знаков):$old6$,
      $new6$§6. ЗАКЛЮЧЕНИЕ (~150 знаков):$new6$
    ),
    $old_tone$ТОН long_explanation: уважительный к традиции, но живой. НЕ
учебник по астрологии. Это разговор эксперта, который любит
дело и хочет поделиться внутренней механикой.

Если в long_explanation всё же упоминаются чакры, допустимы только номерные
названия вида «четвёртая чакра», «третья чакра», «седьмая чакра».
Запрещены санскритские имена чакр, а также конструкции вроде «планета в
Анахате», «энергия Манипуры», «раскрытие Сахасрары».$old_tone$,
    $new_tone$ТОН long_explanation: уважительный к традиции, но живой. НЕ
учебник по астрологии. Это разговор эксперта, который любит
дело и хочет поделиться внутренней механикой.

Если в long_explanation всё же упоминаются чакры, допустимы только номерные
названия вида «четвёртая чакра», «третья чакра», «седьмая чакра».
Запрещены санскритские имена чакр, а также конструкции вроде «планета в
Анахате», «энергия Манипуры», «раскрытие Сахасрары».

В видимых полях JSON (slogan, short_text, long_explanation) запрещены
английские технические ключи harmonic / dissonant / ambivalent_strong /
neutral и английские названия планет. Пиши тон и планеты словами целевого
языка пользователя.$new_tone$
  ),
  variables,
  model_hint,
  temperature,
  max_output_tokens,
  response_format,
  'PATCH: section 6 title without bridge wording; ban English technical tone keys in visible JSON.'
from public.prompts
where prompt_key = 'monologue_morning_recommendation'
  and version = 4
on conflict (prompt_key, version) do update set
  is_active = excluded.is_active,
  template = excluded.template,
  variables = excluded.variables,
  model_hint = excluded.model_hint,
  temperature = excluded.temperature,
  max_output_tokens = excluded.max_output_tokens,
  response_format = excluded.response_format,
  notes = excluded.notes;
