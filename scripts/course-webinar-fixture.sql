-- Only for the isolated course regression database.
create table public.payment_contracts(contract_id text primary key,status text not null);
create table public.webinars(id uuid primary key,starts_at timestamptz not null,is_published boolean default false);
create table public.webinar_passes(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id),
 contract_id text not null unique references public.payment_contracts(contract_id),credits int not null check(credits>0),
 valid_from timestamptz not null,valid_until timestamptz not null,status text not null default 'active',check(valid_until>valid_from)
);
create table public.webinar_registrations(
 webinar_id uuid references public.webinars(id),user_id uuid references public.users(id),
 pass_id uuid references public.webinar_passes(id) on delete set null,primary key(webinar_id,user_id)
);
