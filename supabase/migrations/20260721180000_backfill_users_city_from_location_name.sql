-- Backfill users.city from free-text location_name when reverse-geocode city was never written.
-- Keeps country_code / city as separate columns for admin filters.

update public.users
set city = nullif(trim(split_part(location_name, ',', 1)), '')
where city is null
  and location_name is not null
  and nullif(trim(split_part(location_name, ',', 1)), '') is not null
  -- не брать «Россия» / country-only строки как город
  and lower(trim(split_part(location_name, ',', 1))) not in ('россия', 'russia', 'рф');
