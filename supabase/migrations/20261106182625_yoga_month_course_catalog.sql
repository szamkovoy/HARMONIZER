-- Месячный курс йоги: разовая оплата с лендинга.
-- Российская карта — ЮKassa 24000 ₽. Международная — оффер Lava (EUR/USD с карточки).
-- Тариф приложения и пропуск на вебинары не выдаются. В кабинет приложения не выводится.

alter table public.payment_catalog drop constraint if exists payment_catalog_tier_check;
alter table public.payment_catalog
  add constraint payment_catalog_tier_check
  check (tier in (
    'oracle', 'master', 'webinar', 'webinar_pack', 'book',
    'spb_practicum', 'surcharge', 'yoga_course'
  ));

alter table public.payment_contracts drop constraint if exists payment_contracts_tier_check;
alter table public.payment_contracts
  add constraint payment_contracts_tier_check
  check (tier in (
    'oracle', 'master', 'webinar', 'webinar_pack', 'book',
    'spb_practicum', 'surcharge', 'yoga_course'
  ));

insert into public.payment_catalog
  (provider, tier, currency, amount, title, description, product_kind, lava_offer_id,
   webinar_credits, webinar_window_days, sort_order, letter_subject_i18n, letter_body_i18n)
values (
  'yookassa',
  'yoga_course',
  'RUB',
  24000,
  'Месячный курс йоги с 20% скидкой',
  'Месячный курс йоги с 20% скидкой',
  'one_time',
  '7c9bd26c-70a2-4d98-82b3-a29bbf07b498',
  null,
  null,
  80,
  jsonb_build_object(
    'ru', 'Месячный курс йоги',
    'en', 'Monthly yoga course',
    'de', 'Monatlicher Yogakurs',
    'fr', 'Cours de yoga d''un mois',
    'it', 'Corso di yoga di un mese',
    'es', 'Curso mensual de yoga',
    'pt', 'Curso mensal de yoga',
    'nl', 'Yogacursus van een maand'
  ),
  jsonb_build_object(
    'ru', $ru$Здравствуйте, {{name}}!

Благодарю вас за запись на месячный курс йоги! Пожалуйста, в ответ на это письмо, сообщите мне название курса, который вы хотите пройти. В течение нескольких часов вы получите от меня вводное письмо с первым уроком этого курса. И далее в течение месяца вы будете получать письма с уроками в соответствии с расписанием курса.

С уважением,
Сергей Замковой
sergei@zamkovoi.yoga$ru$,
    'en', $en$Hello, {{name}}!

Thank you for signing up for the monthly yoga course! Please reply to this email and tell me the name of the course you would like to take. Within a few hours you will receive an introductory letter from me with the first lesson of that course. Then, throughout the month, you will receive letters with lessons according to the course schedule.

Kind regards,
Sergei Zamkovoi
sergei@zamkovoi.yoga$en$,
    'de', $de$Guten Tag, {{name}}!

Vielen Dank für Ihre Anmeldung zum monatlichen Yogakurs! Bitte antworten Sie auf diese E-Mail und nennen Sie mir den Namen des Kurses, den Sie besuchen möchten. Innerhalb weniger Stunden erhalten Sie von mir ein Einführungsschreiben mit der ersten Lektion dieses Kurses. Danach erhalten Sie im Laufe des Monats weitere Briefe mit Lektionen entsprechend dem Kursplan.

Mit freundlichen Grüßen
Sergei Zamkovoi
sergei@zamkovoi.yoga$de$,
    'fr', $fr$Bonjour {{name}} !

Je vous remercie pour votre inscription au cours de yoga d'un mois. Merci de répondre à cet e-mail en m'indiquant le nom du cours que vous souhaitez suivre. Dans quelques heures, vous recevrez de ma part une lettre d'introduction avec la première leçon de ce cours. Ensuite, tout au long du mois, vous recevrez des lettres avec les leçons selon le calendrier du cours.

Cordialement,
Sergei Zamkovoi
sergei@zamkovoi.yoga$fr$,
    'it', $it$Buongiorno {{name}},

la ringrazio per l'iscrizione al corso di yoga di un mese. La prego di rispondere a questa email indicandomi il nome del corso che desidera seguire. Entro qualche ora riceverà da me una lettera introduttiva con la prima lezione di quel corso. Poi, nel corso del mese, riceverà lettere con le lezioni secondo il calendario del corso.

Cordiali saluti,
Sergei Zamkovoi
sergei@zamkovoi.yoga$it$,
    'es', $es$Hola, {{name}}:

gracias por inscribirte en el curso mensual de yoga. Por favor, responde a este correo e indícame el nombre del curso que quieres seguir. En unas horas recibirás una carta de presentación con la primera lección de ese curso. Después, a lo largo del mes, recibirás cartas con las lecciones según el calendario del curso.

Un saludo,
Sergei Zamkovoi
sergei@zamkovoi.yoga$es$,
    'pt', $pt$Olá, {{name}}!

Obrigado por se inscrever no curso mensal de yoga. Por favor, responda a este e-mail e diga-me o nome do curso que deseja fazer. Dentro de algumas horas receberá uma carta introdutória com a primeira lição desse curso. Depois, ao longo do mês, receberá cartas com as lições de acordo com o calendário do curso.

Com os melhores cumprimentos,
Sergei Zamkovoi
sergei@zamkovoi.yoga$pt$,
    'nl', $nl$Hallo {{name}},

dank je wel voor je inschrijving voor de yogacursus van een maand. Antwoord alsjeblieft op deze e-mail en laat me weten welke cursus je wilt volgen. Binnen een paar uur ontvang je van mij een introductiebrief met de eerste les van die cursus. Daarna ontvang je gedurende de maand brieven met lessen volgens het rooster van de cursus.

Met vriendelijke groet,
Sergei Zamkovoi
sergei@zamkovoi.yoga$nl$
  )
)
on conflict (provider, tier, currency) do update
set amount = excluded.amount,
    title = excluded.title,
    description = excluded.description,
    product_kind = excluded.product_kind,
    lava_offer_id = excluded.lava_offer_id,
    webinar_credits = null,
    webinar_window_days = null,
    sort_order = excluded.sort_order,
    letter_subject_i18n = excluded.letter_subject_i18n,
    letter_body_i18n = excluded.letter_body_i18n,
    active = true,
    updated_at = now();

-- Виджет как у «Практики в Санкт-Петербурге»: имя, почта, кнопка, прозрачный фон.
-- Цена и переключатель карт видны, потому что российская и международная карты — разные суммы.
insert into public.payment_widgets (title, catalog_id, config)
select
  'Месячный курс йоги с 20% скидкой',
  c.id,
  $cfg${
    "defaultLocale": "ru",
    "paymentMode": "choice",
    "successUrl": null,
    "requireName": true,
    "elements": [
      {"type": "title", "visible": false},
      {"type": "text", "visible": false},
      {"type": "method", "visible": true},
      {"type": "price", "visible": true},
      {"type": "name", "visible": true},
      {"type": "email", "visible": true},
      {"type": "button", "visible": true},
      {"type": "footer", "visible": true}
    ],
    "style": {
      "align": "center",
      "radius": 12,
      "fontSize": 16,
      "maxWidth": 480,
      "paddingX": 24,
      "textColor": "#1f2937",
      "titleSize": 24,
      "background": "transparent",
      "fontFamily": "Montserrat, Arial, sans-serif",
      "paddingTop": 24,
      "accentColor": "#61a5ff",
      "borderColor": "#ffffff",
      "borderWidth": 0,
      "controlRadius": 6,
      "paddingBottom": 24,
      "buttonTextColor": "#ffffff"
    },
    "texts": {
      "ru": {
        "thanksTitle": "Спасибо за оплату!",
        "thanksBody": "Письмо уже отправлено на вашу почту. Ответьте на него и напишите название курса, который хотите пройти. Если письма нет в течение 10 минут, проверьте папку «спам» или напишите на sergei@zamkovoi.yoga"
      },
      "en": {
        "thanksTitle": "Thank you for your payment!",
        "thanksBody": "The email is already on its way. Please reply and tell me the name of the course you would like to take. If it does not arrive within 10 minutes, check your spam folder or write to sergei@zamkovoi.yoga"
      },
      "de": {
        "thanksTitle": "Vielen Dank für Ihre Zahlung!",
        "thanksBody": "Die E-Mail ist bereits unterwegs. Bitte antworten Sie darauf und nennen Sie den Kurs, den Sie besuchen möchten. Wenn sie innerhalb von 10 Minuten nicht ankommt, prüfen Sie den Spam-Ordner oder schreiben Sie an sergei@zamkovoi.yoga"
      },
      "fr": {
        "thanksTitle": "Merci pour votre paiement !",
        "thanksBody": "L'e-mail est déjà en route. Répondez-y en indiquant le nom du cours que vous souhaitez suivre. S'il n'arrive pas dans les 10 minutes, vérifiez les courriers indésirables ou écrivez à sergei@zamkovoi.yoga"
      },
      "it": {
        "thanksTitle": "Grazie per il pagamento!",
        "thanksBody": "L'email è già in viaggio. Rispondi indicando il nome del corso che vuoi seguire. Se non arriva entro 10 minuti, controlla la cartella spam oppure scrivi a sergei@zamkovoi.yoga"
      },
      "es": {
        "thanksTitle": "¡Gracias por tu pago!",
        "thanksBody": "El correo ya va de camino. Respóndelo e indica el nombre del curso que quieres seguir. Si no llega en 10 minutos, revisa el spam o escribe a sergei@zamkovoi.yoga"
      },
      "pt": {
        "thanksTitle": "Obrigado pelo seu pagamento!",
        "thanksBody": "O e-mail já está a caminho. Responda e indique o nome do curso que deseja fazer. Se não chegar em 10 minutos, verifique o spam ou escreva para sergei@zamkovoi.yoga"
      },
      "nl": {
        "thanksTitle": "Bedankt voor je betaling!",
        "thanksBody": "De e-mail is al onderweg. Beantwoord hem en noem de cursus die je wilt volgen. Als hij er binnen 10 minuten niet is, kijk dan in de spam of schrijf naar sergei@zamkovoi.yoga"
      }
    }
  }$cfg$::jsonb
from public.payment_catalog c
where c.provider = 'yookassa' and c.tier = 'yoga_course' and c.currency = 'RUB'
  and not exists (
    select 1 from public.payment_widgets pw where pw.title = 'Месячный курс йоги с 20% скидкой'
  );
