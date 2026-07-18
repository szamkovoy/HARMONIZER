-- Fix webinar/book offerId: ранее заполнен Lava productId, а /api/v2/invoice
-- ожидает ID оффера (второй UUID в платёжной ссылке продукта; он же возвращается
-- GET /api/v2/products?feedVisibility=ALL в offers[].id). Проверено: с этими
-- offerId POST /api/v2/invoice ONE_TIME возвращает 201 + paymentUrl, а цены
-- берутся из карточек продуктов Lava (единообразие сохранено, без «Цена по запросу API»).
--   webinar (CONSULTATION)  product c91d1efe… -> offer 6ddb40b1-1ec5-4ba7-844c-fd1ab66623b4
--   book    (DIGITAL_PRODUCT) product fcf3a2e8… -> offer 4e43fbc1-a37c-43bb-a7eb-e1f8764217c2

update public.payment_offers
  set offer_id = '6ddb40b1-1ec5-4ba7-844c-fd1ab66623b4', updated_at = now()
  where tier = 'webinar' and locale = 'en';

update public.payment_offers
  set offer_id = '4e43fbc1-a37c-43bb-a7eb-e1f8764217c2', updated_at = now()
  where tier = 'book' and locale = 'en';
