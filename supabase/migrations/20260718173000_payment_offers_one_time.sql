-- Seed офферов для разовых товаров: вебинар и книга.
-- offerId = LAVATOP_WEBINAR_ID / LAVATOP_BOOK_ID (продукты ONE_TIME в Lava).
-- Локаль 'en' (fallback); локализованные продукты добавляются позже строками
-- с другими locale — без правки кода (resolveLavaOfferId умеет fallback на en).

insert into public.payment_offers (tier, locale, offer_id) values
  ('webinar', 'en', 'c91d1efe-f32a-428a-bfab-6906a3fa8c05'),
  ('book',    'en', 'fcf3a2e8-132b-4049-bf63-9c796dcda0bb')
on conflict (tier, locale) do nothing;
