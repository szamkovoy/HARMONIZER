/** Default copy of the landing payment widget (8 locales). Admin overrides per widget. */

export const WIDGET_LOCALES = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"] as const;
export type WidgetLocale = (typeof WIDGET_LOCALES)[number];

/** Texts the author can edit per widget and per locale. */
export type WidgetEditableTexts = {
  title: string;
  text: string;
  footer: string;
  namePlaceholder: string;
  emailPlaceholder: string;
  button: string;
  methodRu: string;
  methodInt: string;
  perMonth: string;
  thanksTitle: string;
  thanksBody: string;
};

/** Fixed messages (validation / errors), localized but not editable. */
export type WidgetSystemTexts = {
  errName: string;
  errEmail: string;
  errGeneric: string;
  errEmailRejected: string;
  errAlreadyActive: string;
  errUnavailable: string;
  processing: string;
};

export const WIDGET_EDITABLE_KEYS: readonly (keyof WidgetEditableTexts)[] = [
  "title",
  "text",
  "footer",
  "namePlaceholder",
  "emailPlaceholder",
  "button",
  "methodRu",
  "methodInt",
  "perMonth",
  "thanksTitle",
  "thanksBody",
];

const EDITABLE_DEFAULTS: Record<WidgetLocale, WidgetEditableTexts> = {
  ru: {
    title: "",
    text: "",
    footer: "",
    namePlaceholder: "Имя",
    emailPlaceholder: "Email",
    button: "Оплатить",
    methodRu: "Российская карта",
    methodInt: "Международная карта",
    perMonth: "в месяц",
    thanksTitle: "Спасибо за оплату!",
    thanksBody: "Письмо с подробностями придёт на вашу почту в течение нескольких минут.",
  },
  en: {
    title: "",
    text: "",
    footer: "",
    namePlaceholder: "Name",
    emailPlaceholder: "Email",
    button: "Pay",
    methodRu: "Russian card",
    methodInt: "International card",
    perMonth: "per month",
    thanksTitle: "Thank you for your payment!",
    thanksBody: "An email with the details will arrive in your inbox within a few minutes.",
  },
  de: {
    title: "",
    text: "",
    footer: "",
    namePlaceholder: "Name",
    emailPlaceholder: "E-Mail",
    button: "Bezahlen",
    methodRu: "Russische Karte",
    methodInt: "Internationale Karte",
    perMonth: "pro Monat",
    thanksTitle: "Vielen Dank für Ihre Zahlung!",
    thanksBody: "Eine E-Mail mit allen Details kommt in wenigen Minuten bei Ihnen an.",
  },
  fr: {
    title: "",
    text: "",
    footer: "",
    namePlaceholder: "Prénom",
    emailPlaceholder: "E-mail",
    button: "Payer",
    methodRu: "Carte russe",
    methodInt: "Carte internationale",
    perMonth: "par mois",
    thanksTitle: "Merci pour votre paiement !",
    thanksBody: "Un e-mail avec tous les détails arrivera dans votre boîte dans quelques minutes.",
  },
  it: {
    title: "",
    text: "",
    footer: "",
    namePlaceholder: "Nome",
    emailPlaceholder: "Email",
    button: "Paga",
    methodRu: "Carta russa",
    methodInt: "Carta internazionale",
    perMonth: "al mese",
    thanksTitle: "Grazie per il pagamento!",
    thanksBody: "Entro pochi minuti riceverai un'email con tutti i dettagli.",
  },
  es: {
    title: "",
    text: "",
    footer: "",
    namePlaceholder: "Nombre",
    emailPlaceholder: "Correo electrónico",
    button: "Pagar",
    methodRu: "Tarjeta rusa",
    methodInt: "Tarjeta internacional",
    perMonth: "al mes",
    thanksTitle: "¡Gracias por tu pago!",
    thanksBody: "En unos minutos recibirás un correo con todos los detalles.",
  },
  pt: {
    title: "",
    text: "",
    footer: "",
    namePlaceholder: "Nome",
    emailPlaceholder: "E-mail",
    button: "Pagar",
    methodRu: "Cartão russo",
    methodInt: "Cartão internacional",
    perMonth: "por mês",
    thanksTitle: "Obrigado pelo seu pagamento!",
    thanksBody: "Dentro de alguns minutos receberá um e-mail com todos os detalhes.",
  },
  nl: {
    title: "",
    text: "",
    footer: "",
    namePlaceholder: "Naam",
    emailPlaceholder: "E-mail",
    button: "Betalen",
    methodRu: "Russische kaart",
    methodInt: "Internationale kaart",
    perMonth: "per maand",
    thanksTitle: "Bedankt voor je betaling!",
    thanksBody: "Binnen een paar minuten ontvang je een e-mail met alle details.",
  },
};

const SYSTEM_TEXTS: Record<WidgetLocale, WidgetSystemTexts> = {
  ru: {
    errName: "Введите имя",
    errEmail: "Введите корректный email",
    errGeneric: "Не удалось перейти к оплате. Попробуйте ещё раз.",
    errEmailRejected: "Платёжная система не принимает этот email. Укажите другой.",
    errAlreadyActive: "У вас уже есть активный доступ этого или более высокого уровня.",
    errUnavailable: "Оплата временно недоступна.",
    processing: "Переходим к оплате…",
  },
  en: {
    errName: "Please enter your name",
    errEmail: "Please enter a valid email",
    errGeneric: "Could not start the payment. Please try again.",
    errEmailRejected: "The payment provider does not accept this email. Please use another one.",
    errAlreadyActive: "You already have active access of this or a higher level.",
    errUnavailable: "Payment is temporarily unavailable.",
    processing: "Redirecting to payment…",
  },
  de: {
    errName: "Bitte geben Sie Ihren Namen ein",
    errEmail: "Bitte geben Sie eine gültige E-Mail-Adresse ein",
    errGeneric: "Die Zahlung konnte nicht gestartet werden. Bitte versuchen Sie es erneut.",
    errEmailRejected: "Der Zahlungsanbieter akzeptiert diese E-Mail nicht. Bitte verwenden Sie eine andere.",
    errAlreadyActive: "Sie haben bereits einen aktiven Zugang dieser oder einer höheren Stufe.",
    errUnavailable: "Die Zahlung ist vorübergehend nicht verfügbar.",
    processing: "Weiterleitung zur Zahlung…",
  },
  fr: {
    errName: "Veuillez saisir votre prénom",
    errEmail: "Veuillez saisir une adresse e-mail valide",
    errGeneric: "Impossible de lancer le paiement. Veuillez réessayer.",
    errEmailRejected: "Le prestataire de paiement n'accepte pas cette adresse. Veuillez en utiliser une autre.",
    errAlreadyActive: "Vous disposez déjà d'un accès actif de ce niveau ou d'un niveau supérieur.",
    errUnavailable: "Le paiement est temporairement indisponible.",
    processing: "Redirection vers le paiement…",
  },
  it: {
    errName: "Inserisci il tuo nome",
    errEmail: "Inserisci un'email valida",
    errGeneric: "Impossibile avviare il pagamento. Riprova.",
    errEmailRejected: "Il sistema di pagamento non accetta questa email. Usane un'altra.",
    errAlreadyActive: "Hai già un accesso attivo di questo livello o superiore.",
    errUnavailable: "Il pagamento non è al momento disponibile.",
    processing: "Reindirizzamento al pagamento…",
  },
  es: {
    errName: "Introduce tu nombre",
    errEmail: "Introduce un correo electrónico válido",
    errGeneric: "No se pudo iniciar el pago. Inténtalo de nuevo.",
    errEmailRejected: "El sistema de pago no acepta este correo. Usa otro.",
    errAlreadyActive: "Ya tienes un acceso activo de este nivel o superior.",
    errUnavailable: "El pago no está disponible temporalmente.",
    processing: "Redirigiendo al pago…",
  },
  pt: {
    errName: "Introduza o seu nome",
    errEmail: "Introduza um e-mail válido",
    errGeneric: "Não foi possível iniciar o pagamento. Tente novamente.",
    errEmailRejected: "O sistema de pagamento não aceita este e-mail. Use outro.",
    errAlreadyActive: "Já tem um acesso ativo deste nível ou superior.",
    errUnavailable: "O pagamento está temporariamente indisponível.",
    processing: "A redirecionar para o pagamento…",
  },
  nl: {
    errName: "Vul je naam in",
    errEmail: "Vul een geldig e-mailadres in",
    errGeneric: "De betaling kon niet worden gestart. Probeer het opnieuw.",
    errEmailRejected: "De betaalprovider accepteert dit e-mailadres niet. Gebruik een ander adres.",
    errAlreadyActive: "Je hebt al actieve toegang op dit of een hoger niveau.",
    errUnavailable: "Betalen is tijdelijk niet mogelijk.",
    processing: "Doorsturen naar de betaling…",
  },
};

export function isWidgetLocale(value: unknown): value is WidgetLocale {
  return typeof value === "string" && (WIDGET_LOCALES as readonly string[]).includes(value);
}

export function asWidgetLocale(value: unknown): WidgetLocale | null {
  if (typeof value !== "string") return null;
  const short = value.trim().toLowerCase().slice(0, 2);
  return isWidgetLocale(short) ? short : null;
}

export function getWidgetEditableDefaults(locale: WidgetLocale): WidgetEditableTexts {
  return EDITABLE_DEFAULTS[locale];
}

export function getWidgetSystemTexts(locale: WidgetLocale): WidgetSystemTexts {
  return SYSTEM_TEXTS[locale];
}
