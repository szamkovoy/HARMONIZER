-- Letter for a one-webinar pass bought before a webinar is on the schedule.
-- Blank lines are the gaps in the email. {{name}} is the buyer's name.

update public.payment_catalog
set letter_body_i18n = jsonb_set(
      letter_body_i18n,
      '{ru}',
      to_jsonb($letter$Здравствуйте, {{name}}!

Спасибо за оплату. Вы зарегистрированы на вебинар. Когда я сгенерирую ссылку на вебинарную комнату, по которой нужно будет перейти для участия в вебинаре, я пришлю её вам специальным письмом. А также после вебинара я вышлю вам ссылку на его запись.

Кстати, ссылку на вебинар вы также сможете увидеть в приложении "Гармонизатор", перейдя по баннеру вебинара в верхней части главной страницы приложения (если вы войдёте в Гармонизатор с этим же адресом электронной почты).

До встречи на вебинаре!
Сергей Замковой$letter$::text)
    ),
    updated_at = now()
where provider = 'yookassa'
  and tier = 'webinar'
  and currency = 'RUB';
