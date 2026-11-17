-- Add the author-supplied header only. Preserve all letter subjects and body text; start no enrolments.
insert into public.email_assets(path,public_url) values('email-assets/courses/month-health/header-964940c9d335.png','https://harmonizer.zamkovoi.yoga/email-cdn/email-assets/courses/month-health/header-964940c9d335.png') on conflict(path) do update set public_url=excluded.public_url;
update public.email_automation_steps set
 html_body='<div style="margin:0px 0 24px;text-align:center;"><img src="https://harmonizer.zamkovoi.yoga/email-cdn/email-assets/courses/month-health/header-964940c9d335.png" alt="Месяц здоровья" width="504" height="195" style="width:100%;max-width:100%;height:auto;display:inline-block;border:0;" /></div>'||html_body,
 html_body_i18n=jsonb_set(coalesce(html_body_i18n,'{}'::jsonb),'{ru}',to_jsonb('<div style="margin:0px 0 24px;text-align:center;"><img src="https://harmonizer.zamkovoi.yoga/email-cdn/email-assets/courses/month-health/header-964940c9d335.png" alt="Месяц здоровья" width="504" height="195" style="width:100%;max-width:100%;height:auto;display:inline-block;border:0;" /></div>'||coalesce(nullif(html_body_i18n->>'ru',''),html_body))),
 blocks_i18n=jsonb_set(coalesce(blocks_i18n,'{}'::jsonb),'{ru}','[{"id":"course-month-health-header","type":"image","src":"https://harmonizer.zamkovoi.yoga/email-cdn/email-assets/courses/month-health/header-964940c9d335.png","alt":"Месяц здоровья","width":"100%","naturalWidth":600,"naturalHeight":232,"align":"center","marginTop":0,"marginBottom":24}]'::jsonb||coalesce(blocks_i18n->'ru','[]'::jsonb)),
 updated_at=now()
where automation_id=(select id from public.email_automations where key='course_month-health')
 and not coalesce(blocks_i18n->'ru' @> '[{"id":"course-month-health-header"}]'::jsonb,false);
update public.courses set source_hash='fc18f7dd6d4ba29d8643d62a37e4baae133e611aaa8042f054a8b3f0d17b6e6e' where slug='month-health';
do $$ begin
 if (select count(*) from public.email_automation_steps s join public.email_automations a on a.id=s.automation_id where a.key='course_month-health' and s.blocks_i18n->'ru'->0->>'id'='course-month-health-header' and s.blocks_i18n->'ru'->0->>'align'='center' and s.html_body like '%header-964940c9d335.png%')<>8 then raise exception 'Expected eight centered course headers'; end if;
end $$;
