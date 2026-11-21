-- Yoga and Health: letters 1 and 4–18. Same CTA + GetCourse button as letters 2–3.

-- Letter 1
update public.email_automation_steps
set
  html_body = replace(html_body, 'Первый урок уже доступен вам во вкладке "День" Гармонизатора.</p>', 'Нажмите кнопку ниже, чтобы открыть первый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', 'Первый урок уже доступен вам во вкладке "День" Гармонизатора.</p>', 'Нажмите кнопку ниже, чтобы открыть первый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-01-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', 'Первый урок уже доступен вам во вкладке "День" Гармонизатора.</p>', 'Нажмите кнопку ниже, чтобы открыть первый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = 'fce16504-3e5a-58ac-a8d8-f742fc297527'
  and position('Первый урок уже доступен вам во вкладке "День" Гармонизатора.</p>' in html_body) > 0;

-- Letter 4
update public.email_automation_steps
set
  html_body = replace(html_body, 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть четвёртый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть четвёртый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-04-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть четвёртый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '93895923-3ad1-569c-b39a-11e6c2b1024a'
  and position('Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>' in html_body) > 0;

-- Letter 5
update public.email_automation_steps
set
  html_body = replace(html_body, 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть пятый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть пятый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-05-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть пятый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '8545f986-c4df-5996-980c-586da45c887b'
  and position('Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>' in html_body) > 0;

-- Letter 6
update public.email_automation_steps
set
  html_body = replace(html_body, 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть шестой урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть шестой урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-06-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть шестой урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '76c004cd-9c14-537b-b764-ca57e3299bf3'
  and position('Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>' in html_body) > 0;

-- Letter 7
update public.email_automation_steps
set
  html_body = replace(html_body, '. Он уже доступен вам во вкладке "День" Гармонизатора.</p>', '.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть седьмой урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', '. Он уже доступен вам во вкладке "День" Гармонизатора.</p>', '.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть седьмой урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-07-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', '. Он уже доступен вам во вкладке "День" Гармонизатора.</p>', '.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть седьмой урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = 'ec86e86d-c06b-5223-8b44-d0ea858c2204'
  and position('. Он уже доступен вам во вкладке "День" Гармонизатора.</p>' in html_body) > 0;

-- Letter 8
update public.email_automation_steps
set
  html_body = replace(html_body, 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть восьмой урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть восьмой урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-08-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть восьмой урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '886745bd-03fe-5c61-a2e7-e0d2523ae3d7'
  and position('Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>' in html_body) > 0;

-- Letter 9
update public.email_automation_steps
set
  html_body = replace(html_body, 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть девятый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть девятый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-09-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть девятый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '3297e123-6140-59b0-aca2-ab074c149276'
  and position('Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>' in html_body) > 0;

-- Letter 10
update public.email_automation_steps
set
  html_body = replace(html_body, 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть десятый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть десятый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-10-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть десятый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '23694751-9930-5b5a-a3f9-9d3c342fbcc6'
  and position('Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>' in html_body) > 0;

-- Letter 11
update public.email_automation_steps
set
  html_body = replace(html_body, 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть одиннадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть одиннадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-11-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть одиннадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '2115100c-244b-520a-ae14-a9413fa6bf63'
  and position('Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>' in html_body) > 0;

-- Letter 12
update public.email_automation_steps
set
  html_body = replace(html_body, 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть двенадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть двенадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-12-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть двенадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '06a8574f-1995-5a45-bbcb-1c26b8b969ff'
  and position('Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>' in html_body) > 0;

-- Letter 13
update public.email_automation_steps
set
  html_body = replace(html_body, ' - который уже доступен Вам во вкладке "День" Гармонизатора.</p>', '.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть тринадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', ' - который уже доступен Вам во вкладке "День" Гармонизатора.</p>', '.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть тринадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-13-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', ' - который уже доступен Вам во вкладке "День" Гармонизатора.</p>', '.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть тринадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = 'b5f33e46-97fb-5443-b89f-489852ea54af'
  and position(' - который уже доступен Вам во вкладке "День" Гармонизатора.</p>' in html_body) > 0;

-- Letter 14
update public.email_automation_steps
set
  html_body = replace(html_body, 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть четырнадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть четырнадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-14-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть четырнадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '6787f9e8-a154-58c8-927d-8d181221a21d'
  and position('Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>' in html_body) > 0;

-- Letter 15
update public.email_automation_steps
set
  html_body = replace(html_body, ' Этот урок уже доступен во вкладке "День" Гармонизатора.</p>', '.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть пятнадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', ' Этот урок уже доступен во вкладке "День" Гармонизатора.</p>', '.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть пятнадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-15-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', ' Этот урок уже доступен во вкладке "День" Гармонизатора.</p>', '.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть пятнадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '0e50f72d-a45c-518b-ba5d-e1fc8f4e9622'
  and position(' Этот урок уже доступен во вкладке "День" Гармонизатора.</p>' in html_body) > 0;

-- Letter 16
update public.email_automation_steps
set
  html_body = replace(html_body, 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть шестнадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть шестнадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-16-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть шестнадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '666ac3ed-1e2e-5d76-805f-da19f4eedfd1'
  and position('Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>' in html_body) > 0;

-- Letter 17
update public.email_automation_steps
set
  html_body = replace(html_body, 'Урок уже доступен Вам во вкладке "День" Гармонизатора.</p>', 'Нажмите кнопку ниже, чтобы открыть семнадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', 'Урок уже доступен Вам во вкладке "День" Гармонизатора.</p>', 'Нажмите кнопку ниже, чтобы открыть семнадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-17-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', 'Урок уже доступен Вам во вкладке "День" Гармонизатора.</p>', 'Нажмите кнопку ниже, чтобы открыть семнадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = '0a6d3c02-4663-52e7-94fe-8ea32b98570a'
  and position('Урок уже доступен Вам во вкладке "День" Гармонизатора.</p>' in html_body) > 0;

-- Letter 18
update public.email_automation_steps
set
  html_body = replace(html_body, 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть восемнадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть восемнадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'id' = 'yoga-health-18-text' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', 'Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>', 'Нажмите кнопку ниже, чтобы открыть восемнадцатый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p><p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:#EC543F;border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:#EC543F;mso-line-height-rule:exactly">Перейти к уроку</a></p><p></p>'))
          )
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
    )
  )
where id = 'd1d6535b-a811-503a-b862-13abac07d8a9'
  and position('Урок уже доступен вам во вкладке &quot;День&quot; Гармонизатора.</p><p></p>' in html_body) > 0;

