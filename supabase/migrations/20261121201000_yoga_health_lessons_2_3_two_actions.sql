-- Yoga and Health, letters 2 and 3. The sentence above the button offers
-- two actions: open the lesson with the button, or watch it on the Day tab.
-- The button and the blank lines stay as they are.

update public.email_automation_steps
set
  html_body = replace(
    html_body,
    'в браузере или посмотреть его',
    'в браузере, или посмотрите его'
  ),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(
      html_body_i18n->>'ru',
      'в браузере или посмотреть его',
      'в браузере, или посмотрите его'
    ))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'type' = 'text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(
              elem->>'html',
              'в браузере или посмотреть его',
              'в браузере, или посмотрите его'
            ))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id in (
  'ee74151f-f528-5662-a155-7a4d704fe78d',
  '3adbd858-55c9-5d43-a5a4-8b841006d791'
)
  and position('в браузере или посмотреть его' in html_body) > 0;
