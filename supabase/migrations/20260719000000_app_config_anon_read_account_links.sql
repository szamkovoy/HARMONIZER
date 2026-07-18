-- Kill-switch `account_links_enabled` должен читаться клиентом без
-- активной сессии Supabase (холодный старт, окно sign-out/sign-in,
-- протухший access_token). Раньше RLS разрешал select только
-- `authenticated` — анон получал 0 строк, `useAccountLinksEnabled`
-- кэшировал fail-safe `false` на 5 минут, и кнопка «Личный кабинет»
-- пропадала после переключения пользователя.
--
-- `account_links_enabled` — публичный boolean, не секрет. Открываем
-- select для `anon` ТОЛЬКО по этому ключу; остальные флаги `app_config`
-- остаются доступны только админам/аутентифицированным.

drop policy if exists "app_config readable by anon (account_links_enabled only)"
  on public.app_config;

create policy "app_config readable by anon (account_links_enabled only)"
  on public.app_config
  for select
  to anon, authenticated
  using (key = 'account_links_enabled');
