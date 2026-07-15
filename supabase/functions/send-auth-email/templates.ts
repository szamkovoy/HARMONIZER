// Auto-generated from templates/*.json — embedded to avoid JSON import syntax issues in Supabase Edge Functions.

export interface EmailTemplate {
  subject: string;
  greeting: string;
  intro: string;
  expiry: string;
  ignore: string;
  footer: string;
}

export const TEMPLATES: Record<string, EmailTemplate> = {
  ru: {
    subject: "{code} — ваш код входа в Harmonizer",
    greeting: "Здравствуйте!",
    intro: "Ваш код для входа в приложение Harmonizer:",
    expiry: "Код действует 60 минут и работает только один раз.",
    ignore: "Если вы не запрашивали код, просто проигнорируйте это письмо.",
    footer: "Harmonizer · zamkovoi.yoga",
  },
  en: {
    subject: "{code} — your Harmonizer sign-in code",
    greeting: "Hello!",
    intro: "Your code to sign in to the Harmonizer app:",
    expiry: "The code is valid for 60 minutes and can be used only once.",
    ignore: "If you didn\'t request this code, just ignore this email.",
    footer: "Harmonizer · zamkovoi.yoga",
  },
  de: {
    subject: "{code} — Ihr Anmeldecode für Harmonizer",
    greeting: "Guten Tag!",
    intro: "Ihr Code für die Anmeldung in der Harmonizer-App:",
    expiry: "Der Code ist 60 Minuten gültig und kann nur einmal verwendet werden.",
    ignore: "Falls Sie diesen Code nicht angefordert haben, ignorieren Sie diese E-Mail einfach.",
    footer: "Harmonizer · zamkovoi.yoga",
  },
  fr: {
    subject: "{code} — votre code de connexion Harmonizer",
    greeting: "Bonjour !",
    intro: "Votre code pour vous connecter à l\'application Harmonizer :",
    expiry: "Le code est valable 60 minutes et ne peut être utilisé qu\'une seule fois.",
    ignore: "Si vous n\'avez pas demandé ce code, ignorez simplement cet e-mail.",
    footer: "Harmonizer · zamkovoi.yoga",
  },
  it: {
    subject: "{code} — il tuo codice di accesso a Harmonizer",
    greeting: "Ciao!",
    intro: "Il tuo codice per accedere all\'app Harmonizer:",
    expiry: "Il codice è valido per 60 minuti e può essere usato una sola volta.",
    ignore: "Se non hai richiesto questo codice, ignora semplicemente questa email.",
    footer: "Harmonizer · zamkovoi.yoga",
  },
  es: {
    subject: "{code} — tu código de acceso a Harmonizer",
    greeting: "¡Hola!",
    intro: "Tu código para entrar en la aplicación Harmonizer:",
    expiry: "El código es válido durante 60 minutos y solo puede usarse una vez.",
    ignore: "Si no solicitaste este código, simplemente ignora este correo.",
    footer: "Harmonizer · zamkovoi.yoga",
  },
  pt: {
    subject: "{code} — o seu código de acesso ao Harmonizer",
    greeting: "Olá!",
    intro: "O seu código para entrar na app Harmonizer:",
    expiry: "O código é válido por 60 minutos e só pode ser usado uma vez.",
    ignore: "Se não pediu este código, ignore este e-mail.",
    footer: "Harmonizer · zamkovoi.yoga",
  },
  nl: {
    subject: "{code} — je inlogcode voor Harmonizer",
    greeting: "Hallo!",
    intro: "Je code om in te loggen in de Harmonizer-app:",
    expiry: "De code is 60 minuten geldig en kan maar één keer worden gebruikt.",
    ignore: "Heb je deze code niet aangevraagd? Negeer deze e-mail dan gewoon.",
    footer: "Harmonizer · zamkovoi.yoga",
  },
};

export const DEFAULT_LOCALE = "ru";