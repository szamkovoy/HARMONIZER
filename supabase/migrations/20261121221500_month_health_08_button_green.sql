-- «Ответ на вопрос»: кнопка #569c19 (как у всего практикума).

update public.email_automation_steps
set
  html_body = replace(html_body, '#FF8262', '#569c19'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', '#FF8262', '#569c19'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'month-health-08-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', '#FF8262', '#569c19'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '5d3433c1-caee-5393-bfc8-12f4d790d5f5'
  and (
    html_body like '%#FF8262%'
    or html_body_i18n->>'ru' like '%#FF8262%'
    or blocks_i18n::text like '%#FF8262%'
  );