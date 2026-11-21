-- «дополнительную практику» → «посмотрите её» (letters 4 and 6).

update public.email_automation_steps
set
  html_body = replace(html_body, 'открыть дополнительную практику в браузере, или посмотрите его', 'открыть дополнительную практику в браузере, или посмотрите её'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(
      html_body_i18n->>'ru',
      'открыть дополнительную практику в браузере, или посмотрите его',
      'открыть дополнительную практику в браузере, или посмотрите её'
    ))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' in ('month-health-04-text', 'month-health-06-text') then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(
              elem->>'html',
              'открыть дополнительную практику в браузере, или посмотрите его',
              'открыть дополнительную практику в браузере, или посмотрите её'
            ))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id in ('a521a3fb-4df6-555b-bd63-45dc0c629c98', '28403f28-5a56-59f6-97d9-25e25b7cb2e8');