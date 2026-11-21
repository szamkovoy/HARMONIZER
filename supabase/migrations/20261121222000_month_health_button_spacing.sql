-- Month Health: одна пустая строка под кнопкой (без лишнего editor-спейсера &nbsp;).

update public.email_automation_steps
set
  html_body = replace(
    replace(
      html_body,
      '</a></p><p></p><p style="margin:0;padding:0;line-height:1.55;height:1.55em;font-size:16px !important;font-family:Arial,Helvetica,sans-serif;">&nbsp;</p>',
      '</a></p><p></p>'
    ),
    '</a></p><p style="margin:0;padding:0;line-height:1.55;height:1.55em;font-size:16px !important;font-family:Arial,Helvetica,sans-serif;">&nbsp;</p>',
    '</a></p><p></p>'
  ),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(
      replace(
        replace(
          html_body_i18n->>'ru',
          '</a></p><p></p><p style="margin:0;padding:0;line-height:1.55;height:1.55em;font-size:16px !important;font-family:Arial,Helvetica,sans-serif;">&nbsp;</p>',
          '</a></p><p></p>'
        ),
        '</a></p><p style="margin:0;padding:0;line-height:1.55;height:1.55em;font-size:16px !important;font-family:Arial,Helvetica,sans-serif;">&nbsp;</p>',
        '</a></p><p></p>'
      )
    )
  ),
  blocks_i18n = jsonb_set(
    blocks_i18n,
    '{ru}',
    (
      select jsonb_agg(
        case
          when elem->>'type' = 'text' and elem->>'html' like '%{{course_lesson_url}}%' then jsonb_set(
            elem,
            '{html}',
            to_jsonb(
              replace(
                replace(
                  elem->>'html',
                  '</a></p><p></p><p style="margin:0;padding:0;line-height:1.55;height:1.55em;font-size:16px !important;font-family:Arial,Helvetica,sans-serif;">&nbsp;</p>',
                  '</a></p><p></p>'
                ),
                '</a></p><p style="margin:0;padding:0;line-height:1.55;height:1.55em;font-size:16px !important;font-family:Arial,Helvetica,sans-serif;">&nbsp;</p>',
                '</a></p><p></p>'
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
where automation_id = '48f08712-7146-54dc-ad58-e1dc6ae50879'
  and html_body like '%{{course_lesson_url}}%';