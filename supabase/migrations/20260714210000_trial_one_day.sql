-- Consumption-Only модель: демонстрационный период сокращается с 3 суток до 1.
-- Новый пользователь получает полный доступ уровня «Мастер» на 1 день
-- (trial trumps membership_tier — см. modules/access/core/paidAccess.ts),
-- затем переводится на бесплатный уровень «Навигатор» (free).

alter table public.users
  alter column trial_expires_at set default (now() + interval '1 day');

comment on column public.users.trial_expires_at is
'When the trial ends. Users with trial_expires_at > now() get full master-level access; afterwards access is defined by membership_tier (free = Navigator).';

-- Триггер регистрации: 1 день trial + локаль из user_metadata (email-OTP flow
-- передаёт data: { full_name, locale } в signInWithOtp).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, display_name, locale, membership_tier, trial_expires_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name',
             split_part(new.email, '@', 1)),
    coalesce(nullif(new.raw_user_meta_data->>'locale', ''), 'ru'),
    'free',
    now() + interval '1 day'
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;
