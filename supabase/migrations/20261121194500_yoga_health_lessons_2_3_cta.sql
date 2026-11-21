-- Yoga and Health, letters 2 and 3.
-- The invitation is only a call to action. One blank line above the button.
-- The blank line already sitting before the signature stays under the button.

update public.email_automation_steps
set
  html_body = replace(
    html_body,
    'Второй урок уже готов. Нажмите кнопку ниже, чтобы открыть его в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p style="margin:16px 0;text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a>',
    'Нажмите кнопку ниже, чтобы открыть второй урок в браузере или посмотреть его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a>'
  ),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(
      html_body_i18n->>'ru',
      'Второй урок уже готов. Нажмите кнопку ниже, чтобы открыть его в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p style="margin:16px 0;text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a>',
      'Нажмите кнопку ниже, чтобы открыть второй урок в браузере или посмотреть его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a>'
    ))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-02-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(
              elem->>'html',
              'Второй урок уже готов. Нажмите кнопку ниже, чтобы открыть его в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p style="margin:16px 0;text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a>',
              'Нажмите кнопку ниже, чтобы открыть второй урок в браузере или посмотреть его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a>'
            ))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = 'ee74151f-f528-5662-a155-7a4d704fe78d'
  and html_body like '%Второй урок уже готов.%';

update public.email_automation_steps
set
  html_body = replace(
    html_body,
    'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p>',
    'Нажмите кнопку ниже, чтобы открыть третий урок в браузере или посмотреть его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'
  ),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(
      html_body_i18n->>'ru',
      'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p>',
      'Нажмите кнопку ниже, чтобы открыть третий урок в браузере или посмотреть его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'
    ))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-03-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(
              elem->>'html',
              'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p>',
              'Нажмите кнопку ниже, чтобы открыть третий урок в браузере или посмотреть его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'
            ))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '3adbd858-55c9-5d43-a5a4-8b841006d791'
  and html_body like '%Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.%';
