-- Restore YooKassa Mentor list price (test value 50 broke Master upgrade bonus:
-- floor(remainingDays * 50/4950) always 0). Canonical seed: 950 ₽.
update public.payment_catalog
set amount = 950, updated_at = now()
where provider = 'yookassa'
  and tier = 'oracle'
  and currency = 'RUB'
  and amount = 50;
