-- global_morning_recommendation v4:
-- - short_text: practice hint must use PRIMARY chakra only (first top_petal)
-- - short/long: if chakras are mentioned, use numeric labels only

update public.prompts
set is_active = false
where prompt_key = 'global_morning_recommendation'
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
  response_format
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
        template,
        $old_short$4. Мостик к практике.
   Только в конце мягко скажите, на какую чакру сегодня полезно направить
   внимание в практике.$old_short$,
        $new_short$4. Мостик к практике.
   Только в самом конце мягко скажите, что в утренней практике полезно
   направить внимание на чакру ГЛАВНОЙ планеты дня — первой в top_petals
   (planet + chakra_number). Нельзя называть чакру второй или третьей
   планеты, даже если она кажется уместной по теме практики.

   Если упоминаете чакру, используйте ТОЛЬКО номерное название:
   «первая чакра», «третья чакра», «четвёртая чакра» и т.д.
   Нельзя использовать санскритские имена вроде «Анахата», «Манипура»,
   «Сахасрара».$new_short$
      ),
      $old_long$Это развёрнутый астропсихологический разбор. Здесь уже МОЖНО называть
планеты, аспекты, gravity и транзитную механику, но живым человеческим языком.$old_long$,
      $new_long$Это развёрнутый астропсихологический разбор. Здесь уже МОЖНО называть
планеты, аспекты, gravity и транзитную механику, но живым человеческим языком.

Если в long_explanation упоминаются чакры, используйте ТОЛЬКО номерные
названия вида «четвёртая чакра», «третья чакра», «седьмая чакра».
Запрещены санскритские имена чакр и конструкции вида «планета в Анахате»,
«энергия Манипуры», «раскрытие Сахасрары».$new_long$
    ),
    $old_req$Требования к long_explanation:
- он должен быть заметно богаче и глубже short_text;
- он должен объяснять, а не просто пересказывать;
- он не должен зависеть от натальной карты или личной биографии;
- он должен звучать как комментарий эксперта, а не как заметка из приложения.$old_req$,
    $new_req$Требования к long_explanation:
- он должен быть заметно богаче и глубже short_text;
- он должен объяснять, а не просто пересказывать;
- он не должен зависеть от натальной карты или личной биографии;
- он должен звучать как комментарий эксперта, а не как заметка из приложения;
- если чакры всё же упоминаются, то только номерными названиями, без санскритских имён.$new_req$
  ),
  variables,
  model_hint,
  temperature,
  max_output_tokens,
  response_format
from public.prompts
where prompt_key = 'global_morning_recommendation'
  and version = 3
on conflict (prompt_key, version) do update set
  is_active = excluded.is_active,
  template = excluded.template,
  variables = excluded.variables,
  model_hint = excluded.model_hint,
  temperature = excluded.temperature,
  max_output_tokens = excluded.max_output_tokens,
  response_format = excluded.response_format;
