update public.prompts
set is_active = false
where prompt_key = 'dialog_system_v3';

update public.prompts
set is_active = true
where prompt_key = 'dialog_system_v3'
  and version = 7;
