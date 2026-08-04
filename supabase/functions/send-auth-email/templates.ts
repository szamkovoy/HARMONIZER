// Auto-generated from templates/*.json — embedded to avoid JSON import syntax issues in Supabase Edge Functions.
// OTP body is intentionally short (no marketing guide). RU source of truth; others via i18n-sync.

export interface EmailTemplate {
  subject: string;
  greeting: string;
  greetingName: string;
  intro: string;
  expiry: string;
  ignore: string;
  closing: string;
}

export const TEMPLATES: Record<string, EmailTemplate> = {
  ru: {
    subject: '{code} — ваш код входа в Гармонизатор',
    greeting: 'Здравствуйте!',
    greetingName: 'Здравствуйте, {name}!',
    intro: 'Ваш код для входа в приложение «Гармонизатор»:',
    expiry: 'Код действует 60 минут и работает только один раз.',
    ignore: 'Если вы не запрашивали код, просто проигнорируйте это письмо.',
    closing: 'Всех благ!',
  },
  en: {
    subject: '{code} — your Harmonizer sign-in code',
    greeting: 'Hello!',
    greetingName: 'Hello, {name}!',
    intro: 'Your code to sign in to the Harmonizer app:',
    expiry: 'The code is valid for 60 minutes and can be used only once.',
    ignore: 'If you didn\'t request this code, just ignore this email.',
    closing: 'All the best!',
  },
  de: {
    subject: '{code} — Ihr Anmeldecode für Harmonisierer',
    greeting: 'Guten Tag!',
    greetingName: 'Hallo, {name}!',
    intro: 'Ihr Anmeldecode für die App „Harmonisierer“:',
    expiry: 'Der Code ist 60 Minuten gültig und kann nur einmal verwendet werden.',
    ignore: 'Falls Sie diesen Code nicht angefordert haben, ignorieren Sie diese E-Mail einfach.',
    closing: 'Alles Gute!',
  },
  fr: {
    subject: '{code} — votre code de connexion Harmoniseur',
    greeting: 'Bonjour !',
    greetingName: 'Bonjour {name} !',
    intro: 'Votre code de connexion à l\'application «Harmoniseur»:',
    expiry: 'Le code est valable 60 minutes et ne peut être utilisé qu\'une seule fois.',
    ignore: 'Si vous n\'avez pas demandé ce code, ignorez simplement cet e-mail.',
    closing: 'Bien à vous !',
  },
  it: {
    subject: '{code} — il tuo codice di accesso a Armonizzatore',
    greeting: 'Ciao!',
    greetingName: 'Ciao, {name}!',
    intro: 'Il tuo codice per accedere all\'app «Armonizzatore»:',
    expiry: 'Il codice è valido per 60 minuti e può essere usato una sola volta.',
    ignore: 'Se non hai richiesto questo codice, ignora semplicemente questa email.',
    closing: 'Ti auguro ogni bene!',
  },
  es: {
    subject: '{code} — tu código de acceso a Armonizador',
    greeting: '¡Hola!',
    greetingName: '¡Hola, {name}!',
    intro: 'Tu código para iniciar sesión en «Armonizador»:',
    expiry: 'El código es válido durante 60 minutos y solo puede usarse una vez.',
    ignore: 'Si no solicitaste este código, simplemente ignora este correo.',
    closing: '¡Todo lo mejor!',
  },
  pt: {
    subject: '{code} — o seu código de acesso ao Harmonizador',
    greeting: 'Olá!',
    greetingName: 'Olá, {name}!',
    intro: 'Seu código de acesso ao app «Harmonizador»:',
    expiry: 'O código é válido por 60 minutos e só pode ser usado uma vez.',
    ignore: 'Se não pediu este código, ignore este e-mail.',
    closing: 'Tudo de bom!',
  },
  nl: {
    subject: '{code} — je inlogcode voor Harmoniseerder',
    greeting: 'Hallo!',
    greetingName: 'Hallo, {name}!',
    intro: 'Je inlogcode voor de app «Harmoniseerder»:',
    expiry: 'De code is 60 minuten geldig en kan maar één keer worden gebruikt.',
    ignore: 'Heb je deze code niet aangevraagd? Negeer deze e-mail dan gewoon.',
    closing: 'Al het goede!',
  },
};

export const DEFAULT_LOCALE = "ru";
