-- A stuck delivery update must release its connection in 3 seconds.
-- The webhook then answers 200, so the provider does not retry into a full pool.

alter function public.apply_email_campaign_delivery(text, text, text, text, boolean, jsonb, text, text)
  set statement_timeout = '3s';
