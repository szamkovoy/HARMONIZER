-- Coordinates at which country_code/city were last resolved (Nominatim).
-- Used to skip reverse-geocode until the user moves ≳ 100 km.
alter table public.users
  add column if not exists geo_place_lat double precision,
  add column if not exists geo_place_lon double precision;

comment on column public.users.geo_place_lat is
  'Latitude used when country_code/city were last resolved via reverse geocode.';
comment on column public.users.geo_place_lon is
  'Longitude used when country_code/city were last resolved via reverse geocode.';
