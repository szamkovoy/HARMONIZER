/**
 * Тексты страниц /pay/* и письма о конце 30 дней. Русский — источник.
 * Плейсхолдеры: {tier} — название тарифа, {date} — дата окончания доступа (страница продления).
 */
import { DateTime } from "luxon";

import { asContentLocale, type AppContentLocale } from "../_utils/contentLocales";

export type PayPageCopy = {
  failedTitle: string;
  failedBody: string;
  /** Отказ без известной причины 3‑D Secure. */
  failedBodyGeneric: string;
  /** Человек вернулся с формы, не оплатив. */
  incompleteTitle: string;
  incompleteBody: string;
  payAgain: string;
  payOtherCard: string;
  payForeignCard: string;
  payPaypal: string;
  payApplePay: string;
  /** Вторая группа на странице отказа подписки: разовая оплата 30 дней. */
  passGroupHeading: string;
  passCard: string;
  payPass: string;
  renewTitle: string;
  renewBody: string;
  renewPass: string;
  renewSubscription: string;
  checkingTitle: string;
  checkingBody: string;
  expiredTitle: string;
  expiredBody: string;
  errorTitle: string;
  errorBody: string;
  alreadyTitle: string;
  alreadyBody: string;
  toCabinet: string;
  tierOracle: string;
  tierMaster: string;
  reminderSubject: string;
  reminderBody: string;
  reminderButton: string;
  renewalFailedSubject: string;
  renewalFailedBody: string;
  renewalFailedButton: string;
  paymentFailedSubject: string;
  paymentFailedBody: string;
  paymentFailedButton: string;
  /** Письмо об отказе разовой покупки; кнопка — paymentFailedButton. */
  webinarFailedSubject: string;
  webinarFailedBody: string;
  bookFailedSubject: string;
  bookFailedBody: string;
  /** Подпись под кнопкой во всех письмах об оплате: две строки. */
  letterSignature: string;
};

const COPY: Record<AppContentLocale, PayPageCopy> = {
  ru: {
    failedTitle: "Оплата не удалась",
    failedBody:
      "Банк не подтвердил платёж: неверный код подтверждения или карта не поддерживает 3‑D Secure. Деньги не списаны. Попробуйте ещё раз:",
    failedBodyGeneric:
      "Оплата не прошла, деньги не списаны. Попробуйте ещё раз:",
    incompleteTitle: "Оплата не завершена",
    incompleteBody: "Платёж не завершён, деньги не списаны. Попробуйте ещё раз:",
    payAgain: "Оплатить ещё раз",
    payOtherCard: "Оплатить другой картой",
    payForeignCard: "Оплатить картой иностранного банка",
    payPaypal: "Оплатить через PayPal",
    payApplePay: "Оплатить через Apple Pay",
    passGroupHeading: "Или оплатите только 30 дней, без подписки:",
    passCard: "Оплатить картой",
    payPass: "Оплатить 30 дней без автопродления",
    renewTitle: "Продлить доступ к Гармонизатору",
    renewBody: "Оплаченные 30 дней тарифа «{tier}» заканчиваются {date}. Выберите, как вы хотите продолжить:",
    renewPass: "Оплатить ещё 30 дней",
    renewSubscription: "Оформить подписку с автопродлением",
    checkingTitle: "Проверяем оплату…",
    checkingBody: "Это займёт несколько секунд, страница обновится сама.",
    expiredTitle: "Ссылка устарела",
    expiredBody: "Откройте Личный кабинет — там можно выбрать тариф и оплатить его.",
    errorTitle: "Не получилось открыть оплату",
    errorBody: "Попробуйте ещё раз через минуту. Если не получится — напишите нам, и мы поможем.",
    alreadyTitle: "Доступ уже оплачен",
    alreadyBody: "Тариф уже действует. Подробности — в Личном кабинете.",
    toCabinet: "Перейти в Личный кабинет",
    tierOracle: "Наставник",
    tierMaster: "Мастер",
    reminderSubject: "Через 12 часов заканчивается доступ к Гармонизатору",
    reminderBody:
      "Здравствуйте!\n\nЧерез 12 часов заканчиваются оплаченные 30 дней тарифа «{tier}» в Гармонизаторе. Чтобы практики, прогнозы и диалоги продолжались без перерыва, продлите доступ сейчас — это займёт минуту.",
    reminderButton: "Продлить доступ",
    renewalFailedSubject: "Продление подписки не прошло",
    renewalFailedBody:
      "Здравствуйте!\n\nСписать оплату за продление не получилось. Доступ к Гармонизатору сохраняется до {date}. Чтобы он не прервался, продлите его другой картой, через PayPal или на 30 дней.",
    renewalFailedButton: "Продлить доступ",
    paymentFailedSubject: "Оплата уровня «{tier}» не прошла",
    paymentFailedBody:
      "Здравствуйте!\n\nОплата уровня «{tier}» в Гармонизаторе не прошла — так бывает, когда банк не подтверждает операцию. Деньги не списаны. По кнопке ниже можно оплатить другой картой, через PayPal или оформить 30 дней без автопродления. Вводить данные заново не нужно.",
    paymentFailedButton: "Выбрать способ оплаты",
    webinarFailedSubject: "Оплата участия в вебинаре не прошла",
    webinarFailedBody:
      "Здравствуйте!\n\nОплата участия в вебинаре не прошла — так бывает, когда банк не подтверждает операцию. Деньги не списаны. По кнопке ниже можно оплатить ещё раз или выбрать другой способ оплаты. Вводить данные заново не нужно.",
    bookFailedSubject: "Оплата книги не прошла",
    bookFailedBody:
      "Здравствуйте!\n\nОплата книги не прошла — так бывает, когда банк не подтверждает операцию. Деньги не списаны. По кнопке ниже можно оплатить ещё раз или выбрать другой способ оплаты. Вводить данные заново не нужно.",
    letterSignature: "Всех благ!\nСергей Замковой",
  },
  en: {
    failedTitle: "Payment failed",
    failedBody:
      "Your bank did not confirm the payment: the confirmation code was wrong or the card does not support 3‑D Secure. You have not been charged. Please try again:",
    failedBodyGeneric:
      "The payment did not go through and you have not been charged. Please try again:",
    incompleteTitle: "Payment not completed",
    incompleteBody: "The payment was not completed and you have not been charged. Please try again:",
    payAgain: "Try paying again",
    payOtherCard: "Pay with another card",
    payForeignCard: "Pay with a card from a non-Russian bank",
    payPaypal: "Pay with PayPal",
    payApplePay: "Pay with Apple Pay",
    passGroupHeading: "Or pay for 30 days only, without a subscription:",
    passCard: "Pay by card",
    payPass: "Pay for 30 days without auto-renewal",
    renewTitle: "Extend your Harmonizer access",
    renewBody: "Your 30 paid days of the “{tier}” plan end on {date}. Choose how you would like to continue:",
    renewPass: "Pay for another 30 days",
    renewSubscription: "Subscribe with auto-renewal",
    checkingTitle: "Checking your payment…",
    checkingBody: "This takes a few seconds; the page will refresh on its own.",
    expiredTitle: "This link has expired",
    expiredBody: "Open your account page to choose a plan and pay for it.",
    errorTitle: "We could not open the payment",
    errorBody: "Please try again in a minute. If it still does not work, write to us and we will help.",
    alreadyTitle: "Access is already paid",
    alreadyBody: "Your plan is already active. See details on your account page.",
    toCabinet: "Go to my account",
    tierOracle: "Advisor",
    tierMaster: "Master",
    reminderSubject: "Your Harmonizer access ends in 12 hours",
    reminderBody:
      "Hello!\n\nYour 30 paid days of the “{tier}” plan in Harmonizer end in 12 hours. To keep your practices, forecasts and conversations going without a break, extend your access now — it takes a minute.",
    reminderButton: "Extend access",
    renewalFailedSubject: "Your subscription renewal did not go through",
    renewalFailedBody:
      "Hello!\n\nThe renewal charge did not go through. Your Harmonizer access stays available until {date}. To keep it without a break, renew with another card, PayPal, or 30 days.",
    renewalFailedButton: "Renew access",
    paymentFailedSubject: "Payment for the “{tier}” level did not go through",
    paymentFailedBody:
      "Hello!\n\nPayment for the “{tier}” level in Harmonizer did not go through — this happens when the bank does not confirm the charge. No money was taken. The button below lets you pay with another card, via PayPal, or take 30 days without auto-renewal. You do not need to enter your details again.",
    paymentFailedButton: "Choose how to pay",
    webinarFailedSubject: "Your webinar payment did not go through",
    webinarFailedBody:
      "Hello!\n\nYour payment for the webinar did not go through — this happens when the bank does not confirm the transaction. You have not been charged. Use the button below to pay again or choose another payment method. You will not need to enter your details again.",
    bookFailedSubject: "Your book payment did not go through",
    bookFailedBody:
      "Hello!\n\nYour payment for the book did not go through — this happens when the bank does not confirm the transaction. You have not been charged. Use the button below to pay again or choose another payment method. You will not need to enter your details again.",
    letterSignature: "All the best,\nSergei Zamkovoi",
  },
  de: {
    failedTitle: "Zahlung fehlgeschlagen",
    failedBody:
      "Ihre Bank hat die Zahlung nicht bestätigt: der Bestätigungscode war falsch oder die Karte unterstützt kein 3‑D Secure. Es wurde kein Geld abgebucht. Versuchen Sie es noch einmal:",
    failedBodyGeneric:
      "Die Zahlung ist nicht durchgegangen, es wurde kein Geld abgebucht. Versuchen Sie es noch einmal:",
    incompleteTitle: "Zahlung nicht abgeschlossen",
    incompleteBody: "Die Zahlung wurde nicht abgeschlossen, es wurde kein Geld abgebucht. Versuchen Sie es noch einmal:",
    payAgain: "Erneut bezahlen",
    payOtherCard: "Mit einer anderen Karte bezahlen",
    payForeignCard: "Mit einer Karte einer ausländischen Bank bezahlen",
    payPaypal: "Mit PayPal bezahlen",
    payApplePay: "Mit Apple Pay bezahlen",
    passGroupHeading: "Oder zahlen Sie nur 30 Tage, ohne Abonnement:",
    passCard: "Mit Karte bezahlen",
    payPass: "30 Tage ohne automatische Verlängerung bezahlen",
    renewTitle: "Zugang zum Harmonizer verlängern",
    renewBody: "Ihre 30 bezahlten Tage im Tarif „{tier}“ enden am {date}. Wählen Sie, wie Sie fortfahren möchten:",
    renewPass: "Weitere 30 Tage bezahlen",
    renewSubscription: "Abo mit automatischer Verlängerung abschließen",
    checkingTitle: "Wir prüfen die Zahlung …",
    checkingBody: "Das dauert nur wenige Sekunden, die Seite aktualisiert sich von selbst.",
    expiredTitle: "Der Link ist abgelaufen",
    expiredBody: "Öffnen Sie Ihr Kundenkonto, um einen Tarif zu wählen und zu bezahlen.",
    errorTitle: "Die Zahlung konnte nicht geöffnet werden",
    errorBody: "Bitte versuchen Sie es in einer Minute erneut. Wenn es weiterhin nicht klappt, schreiben Sie uns – wir helfen Ihnen.",
    alreadyTitle: "Der Zugang ist bereits bezahlt",
    alreadyBody: "Ihr Tarif ist bereits aktiv. Details finden Sie in Ihrem Kundenkonto.",
    toCabinet: "Zum Kundenkonto",
    tierOracle: "Mentor",
    tierMaster: "Meister",
    reminderSubject: "Ihr Zugang zum Harmonizer endet in 12 Stunden",
    reminderBody:
      "Hallo!\n\nIhre 30 bezahlten Tage im Tarif „{tier}“ im Harmonizer enden in 12 Stunden. Damit Ihre Übungen, Prognosen und Gespräche ohne Unterbrechung weitergehen, verlängern Sie den Zugang jetzt – das dauert nur eine Minute.",
    reminderButton: "Zugang verlängern",
    renewalFailedSubject: "Die Verlängerung des Abonnements ist nicht gelungen",
    renewalFailedBody:
      "Guten Tag!\n\nDie Zahlung für die Verlängerung ist nicht durchgegangen. Ihr Zugang zu Harmonizer bleibt bis zum {date} bestehen. Damit er nicht abbricht, verlängern Sie ihn mit einer anderen Karte, über PayPal oder für 30 Tage.",
    renewalFailedButton: "Zugang verlängern",
    paymentFailedSubject: "Die Zahlung für die Stufe „{tier}“ ist nicht durchgegangen",
    paymentFailedBody:
      "Guten Tag!\n\nDie Zahlung für die Stufe „{tier}“ im Harmonizer ist nicht durchgegangen — das passiert, wenn die Bank die Buchung nicht bestätigt. Es wurde kein Geld abgebucht. Über die Schaltfläche unten können Sie mit einer anderen Karte, über PayPal oder für 30 Tage ohne automatische Verlängerung zahlen. Ihre Daten müssen Sie nicht erneut eingeben.",
    paymentFailedButton: "Zahlungsart wählen",
    webinarFailedSubject: "Die Zahlung für die Teilnahme am Webinar ist nicht durchgegangen",
    webinarFailedBody:
      "Guten Tag!\n\nDie Zahlung für die Teilnahme am Webinar ist nicht durchgegangen — das passiert, wenn die Bank die Buchung nicht bestätigt. Es wurde kein Geld abgebucht. Über die Schaltfläche unten können Sie erneut bezahlen oder eine andere Zahlungsart wählen. Ihre Daten müssen Sie nicht erneut eingeben.",
    bookFailedSubject: "Die Zahlung für das Buch ist nicht durchgegangen",
    bookFailedBody:
      "Guten Tag!\n\nDie Zahlung für das Buch ist nicht durchgegangen — das passiert, wenn die Bank die Buchung nicht bestätigt. Es wurde kein Geld abgebucht. Über die Schaltfläche unten können Sie erneut bezahlen oder eine andere Zahlungsart wählen. Ihre Daten müssen Sie nicht erneut eingeben.",
    letterSignature: "Alles Gute!\nSergei Zamkovoi",
  },
  fr: {
    failedTitle: "Le paiement a échoué",
    failedBody:
      "Votre banque n’a pas confirmé le paiement : le code de confirmation était incorrect ou la carte ne prend pas en charge 3‑D Secure. Aucun montant n’a été débité. Réessayez :",
    failedBodyGeneric:
      "Le paiement n’a pas abouti, aucun montant n’a été débité. Réessayez :",
    incompleteTitle: "Paiement non terminé",
    incompleteBody: "Le paiement n’a pas été terminé, aucun montant n’a été débité. Réessayez :",
    payAgain: "Payer à nouveau",
    payOtherCard: "Payer avec une autre carte",
    payForeignCard: "Payer avec une carte d’une banque étrangère",
    payPaypal: "Payer avec PayPal",
    payApplePay: "Payer avec Apple Pay",
    passGroupHeading: "Ou payez seulement 30 jours, sans abonnement :",
    passCard: "Payer par carte",
    payPass: "Payer 30 jours sans renouvellement automatique",
    renewTitle: "Prolonger votre accès à Harmonizer",
    renewBody: "Vos 30 jours payés de l’offre « {tier} » se terminent le {date}. Choisissez comment vous souhaitez continuer :",
    renewPass: "Payer 30 jours de plus",
    renewSubscription: "S’abonner avec renouvellement automatique",
    checkingTitle: "Vérification du paiement…",
    checkingBody: "Cela prend quelques secondes, la page se mettra à jour toute seule.",
    expiredTitle: "Ce lien a expiré",
    expiredBody: "Ouvrez votre espace personnel pour choisir une offre et la payer.",
    errorTitle: "Impossible d’ouvrir le paiement",
    errorBody: "Réessayez dans une minute. Si cela ne fonctionne toujours pas, écrivez-nous et nous vous aiderons.",
    alreadyTitle: "L’accès est déjà payé",
    alreadyBody: "Votre offre est déjà active. Les détails sont dans votre espace personnel.",
    toCabinet: "Aller à mon espace personnel",
    tierOracle: "Mentor",
    tierMaster: "Maître",
    reminderSubject: "Votre accès à Harmonizer se termine dans 12 heures",
    reminderBody:
      "Bonjour !\n\nVos 30 jours payés de l’offre « {tier} » dans Harmonizer se terminent dans 12 heures. Pour que vos pratiques, prévisions et dialogues continuent sans interruption, prolongez votre accès maintenant — cela prend une minute.",
    reminderButton: "Prolonger l’accès",
    renewalFailedSubject: "Le renouvellement de l’abonnement n’a pas abouti",
    renewalFailedBody:
      "Bonjour !\n\nLe prélèvement du renouvellement n’est pas passé. Votre accès à Harmonizer reste ouvert jusqu’au {date}. Pour qu’il ne s’interrompe pas, prolongez-le avec une autre carte, via PayPal ou pour 30 jours.",
    renewalFailedButton: "Prolonger l’accès",
    paymentFailedSubject: "Le paiement du niveau « {tier} » n’est pas passé",
    paymentFailedBody:
      "Bonjour !\n\nLe paiement du niveau « {tier} » dans Harmonizer n’est pas passé — cela arrive quand la banque ne confirme pas l’opération. Aucun montant n’a été débité. Le bouton ci-dessous permet de payer avec une autre carte, via PayPal ou pour 30 jours sans renouvellement automatique. Vous n’avez pas à saisir vos données à nouveau.",
    paymentFailedButton: "Choisir le mode de paiement",
    webinarFailedSubject: "Le paiement du webinaire n’est pas passé",
    webinarFailedBody:
      "Bonjour !\n\nLe paiement du webinaire n’est pas passé — cela arrive quand la banque ne confirme pas l’opération. Aucun montant n’a été débité. Le bouton ci-dessous permet de payer à nouveau ou de choisir un autre mode de paiement. Vous n’avez pas à saisir vos données à nouveau.",
    bookFailedSubject: "Le paiement du livre n’est pas passé",
    bookFailedBody:
      "Bonjour !\n\nLe paiement du livre n’est pas passé — cela arrive quand la banque ne confirme pas l’opération. Aucun montant n’a été débité. Le bouton ci-dessous permet de payer à nouveau ou de choisir un autre mode de paiement. Vous n’avez pas à saisir vos données à nouveau.",
    letterSignature: "Tous mes vœux !\nSergei Zamkovoi",
  },
  it: {
    failedTitle: "Pagamento non riuscito",
    failedBody:
      "La banca non ha confermato il pagamento: il codice di conferma era errato oppure la carta non supporta 3‑D Secure. Non è stato addebitato alcun importo. Riprova:",
    failedBodyGeneric:
      "Il pagamento non è andato a buon fine e non è stato addebitato alcun importo. Riprova:",
    incompleteTitle: "Pagamento non completato",
    incompleteBody: "Il pagamento non è stato completato e non è stato addebitato alcun importo. Riprova:",
    payAgain: "Paga di nuovo",
    payOtherCard: "Paga con un’altra carta",
    payForeignCard: "Paga con una carta di una banca estera",
    payPaypal: "Paga con PayPal",
    payApplePay: "Paga con Apple Pay",
    passGroupHeading: "Oppure paga solo 30 giorni, senza abbonamento:",
    passCard: "Paga con carta",
    payPass: "Paga 30 giorni senza rinnovo automatico",
    renewTitle: "Rinnova l’accesso a Harmonizer",
    renewBody: "I tuoi 30 giorni pagati del piano «{tier}» terminano il {date}. Scegli come vuoi procedere:",
    renewPass: "Paga altri 30 giorni",
    renewSubscription: "Abbonati con rinnovo automatico",
    checkingTitle: "Stiamo verificando il pagamento…",
    checkingBody: "Ci vorranno pochi secondi, la pagina si aggiornerà da sola.",
    expiredTitle: "Il link è scaduto",
    expiredBody: "Apri la tua area personale per scegliere un piano e pagarlo.",
    errorTitle: "Non è stato possibile aprire il pagamento",
    errorBody: "Riprova tra un minuto. Se ancora non funziona, scrivici e ti aiuteremo.",
    alreadyTitle: "L’accesso è già pagato",
    alreadyBody: "Il tuo piano è già attivo. Trovi i dettagli nella tua area personale.",
    toCabinet: "Vai alla mia area personale",
    tierOracle: "Mentore",
    tierMaster: "Maestro",
    reminderSubject: "Il tuo accesso a Harmonizer termina tra 12 ore",
    reminderBody:
      "Ciao!\n\nI tuoi 30 giorni pagati del piano «{tier}» in Harmonizer terminano tra 12 ore. Perché pratiche, previsioni e dialoghi continuino senza interruzioni, rinnova l’accesso adesso: ci vuole un minuto.",
    reminderButton: "Rinnova l’accesso",
    renewalFailedSubject: "Il rinnovo dell’abbonamento non è andato a buon fine",
    renewalFailedBody:
      "Buongiorno!\n\nL’addebito del rinnovo non è riuscito. L’accesso a Harmonizer resta disponibile fino al {date}. Perché non si interrompa, rinnovatelo con un’altra carta, con PayPal oppure per 30 giorni.",
    renewalFailedButton: "Rinnova l’accesso",
    paymentFailedSubject: "Il pagamento del livello «{tier}» non è andato a buon fine",
    paymentFailedBody:
      "Buongiorno!\n\nIl pagamento del livello «{tier}» in Harmonizer non è andato a buon fine: succede quando la banca non conferma l’operazione. Nessun importo è stato addebitato. Con il pulsante qui sotto puoi pagare con un’altra carta, con PayPal oppure per 30 giorni senza rinnovo automatico. Non devi inserire di nuovo i dati.",
    paymentFailedButton: "Scegli come pagare",
    webinarFailedSubject: "Il pagamento del webinar non è andato a buon fine",
    webinarFailedBody:
      "Buongiorno!\n\nIl pagamento del webinar non è andato a buon fine: succede quando la banca non conferma l’operazione. Nessun importo è stato addebitato. Con il pulsante qui sotto puoi pagare di nuovo o scegliere un altro metodo di pagamento. Non devi inserire di nuovo i dati.",
    bookFailedSubject: "Il pagamento del libro non è andato a buon fine",
    bookFailedBody:
      "Buongiorno!\n\nIl pagamento del libro non è andato a buon fine: succede quando la banca non conferma l’operazione. Nessun importo è stato addebitato. Con il pulsante qui sotto puoi pagare di nuovo o scegliere un altro metodo di pagamento. Non devi inserire di nuovo i dati.",
    letterSignature: "I migliori auguri!\nSergei Zamkovoi",
  },
  es: {
    failedTitle: "El pago no se ha completado",
    failedBody:
      "El banco no ha confirmado el pago: el código de confirmación era incorrecto o la tarjeta no admite 3‑D Secure. No se ha cobrado nada. Inténtalo de nuevo:",
    failedBodyGeneric:
      "El pago no se ha realizado y no se ha cobrado nada. Inténtalo de nuevo:",
    incompleteTitle: "Pago no completado",
    incompleteBody: "El pago no se ha completado y no se ha cobrado nada. Inténtalo de nuevo:",
    payAgain: "Pagar de nuevo",
    payOtherCard: "Pagar con otra tarjeta",
    payForeignCard: "Pagar con una tarjeta de un banco extranjero",
    payPaypal: "Pagar con PayPal",
    payApplePay: "Pagar con Apple Pay",
    passGroupHeading: "O paga solo 30 días, sin suscripción:",
    passCard: "Pagar con tarjeta",
    payPass: "Pagar 30 días sin renovación automática",
    renewTitle: "Amplía tu acceso a Harmonizer",
    renewBody: "Tus 30 días pagados del plan «{tier}» terminan el {date}. Elige cómo quieres continuar:",
    renewPass: "Pagar otros 30 días",
    renewSubscription: "Suscribirme con renovación automática",
    checkingTitle: "Comprobando el pago…",
    checkingBody: "Tardará unos segundos; la página se actualizará sola.",
    expiredTitle: "El enlace ha caducado",
    expiredBody: "Abre tu área personal para elegir un plan y pagarlo.",
    errorTitle: "No se ha podido abrir el pago",
    errorBody: "Inténtalo de nuevo dentro de un minuto. Si sigue sin funcionar, escríbenos y te ayudaremos.",
    alreadyTitle: "El acceso ya está pagado",
    alreadyBody: "Tu plan ya está activo. Encontrarás los detalles en tu área personal.",
    toCabinet: "Ir a mi área personal",
    tierOracle: "Mentor",
    tierMaster: "Maestro",
    reminderSubject: "Tu acceso a Harmonizer termina en 12 horas",
    reminderBody:
      "¡Hola!\n\nTus 30 días pagados del plan «{tier}» en Harmonizer terminan en 12 horas. Para que tus prácticas, previsiones y diálogos sigan sin interrupción, amplía el acceso ahora: solo te llevará un minuto.",
    reminderButton: "Ampliar el acceso",
    renewalFailedSubject: "La renovación de la suscripción no se ha completado",
    renewalFailedBody:
      "Hola:\n\nEl cobro de la renovación no se ha realizado. Tu acceso a Harmonizer sigue disponible hasta el {date}. Para que no se interrumpa, renuévalo con otra tarjeta, con PayPal o por 30 días.",
    renewalFailedButton: "Renovar el acceso",
    paymentFailedSubject: "El pago del nivel «{tier}» no se ha completado",
    paymentFailedBody:
      "Hola:\n\nEl pago del nivel «{tier}» en Harmonizer no se ha completado. Pasa cuando el banco no confirma la operación. No se ha cobrado nada. Con el botón de abajo puedes pagar con otra tarjeta, con PayPal o por 30 días sin renovación automática. No hace falta volver a introducir los datos.",
    paymentFailedButton: "Elegir la forma de pago",
    webinarFailedSubject: "El pago del webinar no se ha completado",
    webinarFailedBody:
      "Hola:\n\nEl pago del webinar no se ha completado. Pasa cuando el banco no confirma la operación. No se ha cobrado nada. Con el botón de abajo puedes pagar de nuevo o elegir otra forma de pago. No hace falta volver a introducir los datos.",
    bookFailedSubject: "El pago del libro no se ha completado",
    bookFailedBody:
      "Hola:\n\nEl pago del libro no se ha completado. Pasa cuando el banco no confirma la operación. No se ha cobrado nada. Con el botón de abajo puedes pagar de nuevo o elegir otra forma de pago. No hace falta volver a introducir los datos.",
    letterSignature: "Mis mejores deseos,\nSergei Zamkovoi",
  },
  pt: {
    failedTitle: "O pagamento não foi concluído",
    failedBody:
      "O banco não confirmou o pagamento: o código de confirmação estava incorreto ou o cartão não é compatível com 3‑D Secure. Não foi cobrado qualquer valor. Tente novamente:",
    failedBodyGeneric:
      "O pagamento não foi efetuado e não foi cobrado qualquer valor. Tente novamente:",
    incompleteTitle: "Pagamento não concluído",
    incompleteBody: "O pagamento não foi concluído e não foi cobrado qualquer valor. Tente novamente:",
    payAgain: "Pagar novamente",
    payOtherCard: "Pagar com outro cartão",
    payForeignCard: "Pagar com um cartão de um banco estrangeiro",
    payPaypal: "Pagar com PayPal",
    payApplePay: "Pagar com Apple Pay",
    passGroupHeading: "Ou pague apenas 30 dias, sem assinatura:",
    passCard: "Pagar com cartão",
    payPass: "Pagar 30 dias sem renovação automática",
    renewTitle: "Prolongar o acesso ao Harmonizer",
    renewBody: "Os seus 30 dias pagos do plano «{tier}» terminam em {date}. Escolha como deseja continuar:",
    renewPass: "Pagar mais 30 dias",
    renewSubscription: "Assinar com renovação automática",
    checkingTitle: "A verificar o pagamento…",
    checkingBody: "Isto demora alguns segundos; a página vai atualizar-se sozinha.",
    expiredTitle: "O link expirou",
    expiredBody: "Abra a sua área pessoal para escolher um plano e pagá-lo.",
    errorTitle: "Não foi possível abrir o pagamento",
    errorBody: "Tente novamente daqui a um minuto. Se continuar sem funcionar, escreva-nos e vamos ajudar.",
    alreadyTitle: "O acesso já está pago",
    alreadyBody: "O seu plano já está ativo. Veja os detalhes na sua área pessoal.",
    toCabinet: "Ir para a minha área pessoal",
    tierOracle: "Mentor",
    tierMaster: "Mestre",
    reminderSubject: "O seu acesso ao Harmonizer termina daqui a 12 horas",
    reminderBody:
      "Olá!\n\nOs seus 30 dias pagos do plano «{tier}» no Harmonizer terminam daqui a 12 horas. Para que as práticas, previsões e diálogos continuem sem interrupção, prolongue o acesso agora — leva um minuto.",
    reminderButton: "Prolongar o acesso",
    renewalFailedSubject: "A renovação da subscrição não foi concluída",
    renewalFailedBody:
      "Olá!\n\nA cobrança da renovação não passou. O seu acesso ao Harmonizer mantém-se até {date}. Para não se interromper, renove-o com outro cartão, pelo PayPal ou por 30 dias.",
    renewalFailedButton: "Prolongar o acesso",
    paymentFailedSubject: "O pagamento do nível «{tier}» não foi concluído",
    paymentFailedBody:
      "Olá!\n\nO pagamento do nível «{tier}» no Harmonizer não foi concluído — isto acontece quando o banco não confirma a operação. Não foi cobrado qualquer valor. No botão abaixo pode pagar com outro cartão, pelo PayPal ou por 30 dias sem renovação automática. Não precisa de introduzir os dados outra vez.",
    paymentFailedButton: "Escolher a forma de pagamento",
    webinarFailedSubject: "O pagamento do webinar não foi concluído",
    webinarFailedBody:
      "Olá!\n\nO pagamento do webinar não foi concluído — isto acontece quando o banco não confirma a operação. Não foi cobrado qualquer valor. No botão abaixo pode pagar novamente ou escolher outra forma de pagamento. Não precisa de introduzir os dados outra vez.",
    bookFailedSubject: "O pagamento do livro não foi concluído",
    bookFailedBody:
      "Olá!\n\nO pagamento do livro não foi concluído — isto acontece quando o banco não confirma a operação. Não foi cobrado qualquer valor. No botão abaixo pode pagar novamente ou escolher outra forma de pagamento. Não precisa de introduzir os dados outra vez.",
    letterSignature: "Tudo de bom!\nSergei Zamkovoi",
  },
  nl: {
    failedTitle: "Betaling mislukt",
    failedBody:
      "Je bank heeft de betaling niet bevestigd: de bevestigingscode was onjuist of de kaart ondersteunt geen 3‑D Secure. Er is geen geld afgeschreven. Probeer het opnieuw:",
    failedBodyGeneric:
      "De betaling is niet gelukt en er is geen geld afgeschreven. Probeer het opnieuw:",
    incompleteTitle: "Betaling niet afgerond",
    incompleteBody: "De betaling is niet afgerond en er is geen geld afgeschreven. Probeer het opnieuw:",
    payAgain: "Opnieuw betalen",
    payOtherCard: "Betalen met een andere kaart",
    payForeignCard: "Betalen met een kaart van een buitenlandse bank",
    payPaypal: "Betalen met PayPal",
    payApplePay: "Betalen met Apple Pay",
    passGroupHeading: "Of betaal alleen 30 dagen, zonder abonnement:",
    passCard: "Betalen met kaart",
    payPass: "30 dagen betalen zonder automatische verlenging",
    renewTitle: "Je toegang tot Harmonizer verlengen",
    renewBody: "Je 30 betaalde dagen van het abonnement ‘{tier}’ eindigen op {date}. Kies hoe je verder wilt gaan:",
    renewPass: "Nog 30 dagen betalen",
    renewSubscription: "Abonneren met automatische verlenging",
    checkingTitle: "We controleren de betaling…",
    checkingBody: "Dit duurt een paar seconden; de pagina ververst vanzelf.",
    expiredTitle: "Deze link is verlopen",
    expiredBody: "Open je persoonlijke account om een abonnement te kiezen en te betalen.",
    errorTitle: "De betaling kon niet worden geopend",
    errorBody: "Probeer het over een minuut opnieuw. Lukt het nog steeds niet, schrijf ons dan en we helpen je.",
    alreadyTitle: "De toegang is al betaald",
    alreadyBody: "Je abonnement is al actief. Details vind je in je persoonlijke account.",
    toCabinet: "Naar mijn account",
    tierOracle: "Mentor",
    tierMaster: "Meester",
    reminderSubject: "Je toegang tot Harmonizer eindigt over 12 uur",
    reminderBody:
      "Hallo!\n\nJe 30 betaalde dagen van het abonnement ‘{tier}’ in Harmonizer eindigen over 12 uur. Verleng je toegang nu, zodat je oefeningen, voorspellingen en gesprekken zonder onderbreking doorgaan — het kost maar een minuut.",
    reminderButton: "Toegang verlengen",
    renewalFailedSubject: "De verlenging van het abonnement is niet gelukt",
    renewalFailedBody:
      "Hallo!\n\nDe afschrijving voor de verlenging is niet gelukt. Je toegang tot Harmonizer blijft tot {date}. Zodat die niet onderbreekt, verleng je hem met een andere kaart, via PayPal of voor 30 dagen.",
    renewalFailedButton: "Toegang verlengen",
    paymentFailedSubject: "De betaling voor het niveau «{tier}» is niet gelukt",
    paymentFailedBody:
      "Hallo!\n\nDe betaling voor het niveau «{tier}» in Harmonizer is niet gelukt — dat gebeurt wanneer de bank de transactie niet bevestigt. Er is geen geld afgeschreven. Via de knop hieronder kun je met een andere kaart, via PayPal of voor 30 dagen zonder automatische verlenging betalen. Je gegevens hoef je niet opnieuw in te vullen.",
    paymentFailedButton: "Betaalwijze kiezen",
    webinarFailedSubject: "De betaling voor het webinar is niet gelukt",
    webinarFailedBody:
      "Hallo!\n\nDe betaling voor het webinar is niet gelukt — dat gebeurt wanneer de bank de transactie niet bevestigt. Er is geen geld afgeschreven. Via de knop hieronder kun je opnieuw betalen of een andere betaalwijze kiezen. Je gegevens hoef je niet opnieuw in te vullen.",
    bookFailedSubject: "De betaling voor het boek is niet gelukt",
    bookFailedBody:
      "Hallo!\n\nDe betaling voor het boek is niet gelukt — dat gebeurt wanneer de bank de transactie niet bevestigt. Er is geen geld afgeschreven. Via de knop hieronder kun je opnieuw betalen of een andere betaalwijze kiezen. Je gegevens hoef je niet opnieuw in te vullen.",
    letterSignature: "Alle goeds!\nSergei Zamkovoi",
  },
};

export function getPayPageCopy(locale: string | null | undefined): PayPageCopy & { lang: AppContentLocale } {
  const lang = asContentLocale(locale) ?? "ru";
  return { lang, ...COPY[lang] };
}

export function payTierName(copy: PayPageCopy, tier: string): string {
  return tier === "master" ? copy.tierMaster : copy.tierOracle;
}

/** Дата окончания доступа на языке пользователя, без времени. */
export function formatPayDate(iso: string, lang: AppContentLocale): string {
  return DateTime.fromISO(iso, { zone: "utc" }).setLocale(lang).toLocaleString(DateTime.DATE_FULL);
}

export function fillPayCopy(text: string, vars: { tier?: string; date?: string }): string {
  return text.replaceAll("{tier}", vars.tier ?? "").replaceAll("{date}", vars.date ?? "");
}
