-- Admin panel foundation (phase 0): full 4-tier membership model in DB.
--
-- Before: check (membership_tier in ('free','premium')) — client already maps
-- premium -> oracle and supports oracle/practitioner/master (modules/access).
-- After this migration the DB stores the same 4-tier model the client uses:
--   paid   = membership_tier in ('oracle','practitioner','master')
--            AND (membership_expires_at IS NULL OR membership_expires_at > now())
--   trial  = trial_expires_at > now() (full master-level access, source "trial")
--   free   = everything else, including expired paid grants.
--
-- membership_expires_at supports manual tier grants from the admin panel
-- (fixed period, no auto-renewal). NULL = no expiry (e.g. future auto-renewed
-- subscriptions or permanent grants).

alter table public.users
  drop constraint if exists users_membership_tier_check;

update public.users
set membership_tier = 'oracle'
where membership_tier = 'premium';

alter table public.users
  add constraint users_membership_tier_check
  check (membership_tier in ('free', 'oracle', 'practitioner', 'master'));

alter table public.users
  add column if not exists membership_expires_at timestamptz;

comment on column public.users.membership_tier is
'Product tier: free | oracle | practitioner | master. Paid tiers are effective only while membership_expires_at is NULL or in the future.';

comment on column public.users.membership_expires_at is
'When a granted/paid tier expires (NULL = no expiry). Expired paid tier is treated as free. Set by admin panel manual grants; future payment integration will also write it.';
