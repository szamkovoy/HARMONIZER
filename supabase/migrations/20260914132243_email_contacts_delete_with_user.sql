-- Deleting a user must delete their marketing contact, not leave a row
-- with user_id NULL in «Вся база». Payments stay ON DELETE SET NULL (ledger).
-- Also drop already-unlinked leftover contacts (GetCourse import junk + wipes).

delete from public.email_contacts
where user_id is null;

alter table public.email_contacts
  drop constraint email_contacts_user_id_fkey;

alter table public.email_contacts
  add constraint email_contacts_user_id_fkey
  foreign key (user_id) references public.users(id) on delete cascade;
