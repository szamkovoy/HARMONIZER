-- Month Health «Урок 1» и «Ответ на вопрос»: CTA в blocks_i18n и html_body_i18n
-- (предыдущая замена не совпала со style без дубля word-break).

-- «Урок 1»
update public.email_automation_steps
set
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(
      replace(
        html_body_i18n->>'ru',
        '<p>Урок ждёт вас в Гармонизаторе, на вкладке «День».</p><p></p>',
        '<p>Нажмите кнопку ниже, чтобы открыть первый (вводный) урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#569c19;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#569c19;mso-line-height-rule:exactly">Открыть урок 1</a></p><p></p>'
      )
    )
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
  (
      select jsonb_agg(
        case
          when elem->>'id' = 'month-health-01-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(
              replace(
                elem->>'html',
                '<p style="margin:0;padding:0;word-break:break-word;overflow-wrap:anywhere;font-size:16px !important;line-height:24px;font-family:Arial,Helvetica,sans-serif;">Урок ждёт вас в Гармонизаторе, на вкладке «День».</p>',
                '<p>Нажмите кнопку ниже, чтобы открыть первый (вводный) урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#569c19;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#569c19;mso-line-height-rule:exactly">Открыть урок 1</a></p><p></p>'
              )
            )
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '85913963-0a67-5393-ab3c-8263e17fab9a';

-- «Ответ на вопрос»
update public.email_automation_steps
set
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(
      replace(
        html_body_i18n->>'ru',
        '<p>Видео ждёт вас в Гармонизаторе, на вкладке «День».</p><p></p>',
        '<p>Нажмите кнопку ниже, чтобы открыть это видео в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#FF8262;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#FF8262;mso-line-height-rule:exactly">Посмотреть видео...</a></p><p></p>'
      )
    )
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
            to_jsonb(
              replace(
                elem->>'html',
                '<p style="margin:0;padding:0;word-break:break-word;overflow-wrap:anywhere;font-size:16px !important;line-height:24px;font-family:Arial,Helvetica,sans-serif;">Видео ждёт вас в Гармонизаторе, на вкладке «День».</p>',
                '<p>Нажмите кнопку ниже, чтобы открыть это видео в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#FF8262;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#FF8262;mso-line-height-rule:exactly">Посмотреть видео...</a></p><p></p>'
              )
            )
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '5d3433c1-caee-5393-bfc8-12f4d790d5f5';