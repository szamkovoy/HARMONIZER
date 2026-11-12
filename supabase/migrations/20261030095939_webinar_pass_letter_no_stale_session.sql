-- The one-webinar purchase letter is sent only when no webinar is on the
-- schedule yet. It must not name a past session or a room link: that text
-- stays until the next edit, and buyers receive it as if it were current.
-- The link and the start time go out later, in the invitation, when the
-- announcement is published. The four-webinar letter promised that link
-- about an hour before the start; the invitation is sent when the webinar
-- is added, not on a timer.

update public.payment_catalog
set letter_body_i18n = jsonb_set(
      letter_body_i18n,
      '{ru}',
      to_jsonb($letter$Здравствуйте, {{name}}!

Спасибо за оплату. Вы записаны на ближайший вебинар — он пройдёт в течение 7 дней с момента оплаты.

Когда вебинар появится в расписании, я пришлю отдельное письмо со ссылкой на трансляцию и временем начала. Ссылка также появится в приложении «Гармонизатор», если вы войдёте в него с этим же адресом электронной почты.

До встречи на вебинаре!
Сергей Замковой$letter$::text)
    ),
    updated_at = now()
where provider = 'yookassa'
  and tier = 'webinar'
  and currency = 'RUB'
  and (
    coalesce(letter_body_i18n->>'ru', '') like '%17 сентября%'
    or coalesce(letter_body_i18n->>'ru', '') like '%Примерно за час до начала%'
  );

update public.payment_catalog
set letter_body_i18n = jsonb_set(
      letter_body_i18n,
      '{ru}',
      to_jsonb($letter$Здравствуйте, {{name}}!

Спасибо за оплату. В течение 28 дней с момента оплаты вы можете участвовать в четырёх вебинарах. Я сам запишу вас на каждый из них.

Когда очередной вебинар появится в расписании, я пришлю отдельное письмо со ссылкой на трансляцию и временем начала. Ссылки также появятся в приложении «Гармонизатор», если вы войдёте в него с этим же адресом электронной почты.

До встречи на вебинарах!
Сергей Замковой$letter$::text)
    ),
    updated_at = now()
where provider = 'yookassa'
  and tier = 'webinar_pack'
  and currency = 'RUB'
  and coalesce(letter_body_i18n->>'ru', '') like '%Примерно за час до начала%';
