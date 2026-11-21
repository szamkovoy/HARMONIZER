-- Month Love: one blank line under lesson button (not two).

update public.email_automation_steps set
  html_body = replace(html_body, '</a></p><p></p><p></p>', '</a></p><p></p>'),
  html_body_i18n = jsonb_set(
    html_body_i18n,
    '{ru}',
    to_jsonb(replace(html_body_i18n->>'ru', '</a></p><p></p><p></p>', '</a></p><p></p>'))
  ),
  blocks_i18n = jsonb_set(blocks_i18n, '{ru}', (
    select jsonb_agg(
      case
        when elem->>'type' = 'text' and (elem->>'html') like '%{{course_lesson_url}}%'
          then jsonb_set(
            elem,
            '{html}',
            to_jsonb(replace(elem->>'html', '</a></p><p></p><p></p>', '</a></p><p></p>'))
          )
        else elem
      end
      order by ord
    )
    from jsonb_array_elements(blocks_i18n->'ru') with ordinality as t(elem, ord)
  ))
where id in (
  '9ced276a-d690-585e-a584-c4549476cc04',
  '42bc1762-9a13-5963-bdd5-3ea0e5f950a7',
  'dce9025b-79f7-52bb-b59c-6878efbe78b9',
  'b3506cf1-55c7-5f48-9e64-a4f63327b1cf',
  'e4d17696-cfb3-5b07-8946-db525d9a2919',
  '8c6ef150-9141-5b93-a9a6-b9792090f84c',
  'b3fded35-19a8-5972-8e91-9b5e85e78d75'
);