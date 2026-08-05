-- Store-review demo account flag (App Store / Google Play login notes).
-- Secrets STORE_REVIEW_EMAIL / STORE_REVIEW_OTP live on Vercel + edge only.

alter table public.users
  add column if not exists store_review_account boolean not null default false;

comment on column public.users.store_review_account is
  'App Store / Play review demo: hide cabinet / sign-out / delete in the app; membership granted by ops + otp-verify ensure.';

create index if not exists users_store_review_account_idx
  on public.users (id)
  where store_review_account = true;
