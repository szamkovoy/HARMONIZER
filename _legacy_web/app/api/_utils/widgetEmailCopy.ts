/**
 * Copy for letters to widget buyers (purchase letter footer, webinar join letter).
 * The purchase letter body itself is authored per product in payment_catalog.letter_*_i18n.
 */
import { asWidgetLocale, type WidgetLocale } from "../../../lib/paymentWidget/copy";

export type WidgetEmailCopy = {
  footer: { before: string; link: string; after: string };
  joinSubject: (title: string) => string;
  joinGreeting: (name: string) => string;
  joinGreetingNoName: string;
  joinBody: (title: string) => string;
  joinButton: string;
  joinFallbackLink: string;
  joinAppHint: string;
};

const COPY: Record<WidgetLocale, WidgetEmailCopy> = {
  ru: {
    footer: {
      before:
        "Вы получили это письмо, потому что оплатили участие на сайте Сергея Замкового. Если вы не хотите получать мои рассылки, вы можете",
      link: "отписаться",
      after: ".",
    },
    joinSubject: (t) => `Скоро начнётся вебинар «${t}»`,
    joinGreeting: (n) => `Здравствуйте, ${n}!`,
    joinGreetingNoName: "Здравствуйте!",
    joinBody: (t) => `Вебинар «${t}» скоро начнётся. Подключайтесь по ссылке — я буду рад вас видеть.`,
    joinButton: "Перейти к трансляции",
    joinFallbackLink: "Если кнопка не открывается, скопируйте ссылку:",
    joinAppHint: "Ссылка на трансляцию и запись вебинара есть и в приложении «Гармонизатор» — войдите в него с этим email.",
  },
  en: {
    footer: {
      before:
        "You received this email because you paid for participation on Sergei Zamkovoi's website. If you no longer want to receive my newsletters, you can",
      link: "unsubscribe",
      after: ".",
    },
    joinSubject: (t) => `The webinar “${t}” starts soon`,
    joinGreeting: (n) => `Hello, ${n}!`,
    joinGreetingNoName: "Hello!",
    joinBody: (t) => `The webinar “${t}” is about to begin. Join via the link — I'll be glad to see you.`,
    joinButton: "Join the stream",
    joinFallbackLink: "If the button does not open, copy this link:",
    joinAppHint: "The stream link and the recording are also in the Harmonizer app — sign in with this email.",
  },
  de: {
    footer: {
      before:
        "Sie erhalten diese E-Mail, weil Sie auf der Website von Sergei Zamkovoi eine Teilnahme bezahlt haben. Wenn Sie meine Newsletter nicht mehr erhalten möchten, können Sie sich",
      link: "abmelden",
      after: ".",
    },
    joinSubject: (t) => `Das Webinar „${t}“ beginnt bald`,
    joinGreeting: (n) => `Hallo ${n}!`,
    joinGreetingNoName: "Hallo!",
    joinBody: (t) => `Das Webinar „${t}“ beginnt gleich. Nehmen Sie über den Link teil — ich freue mich auf Sie.`,
    joinButton: "Zum Livestream",
    joinFallbackLink: "Falls sich die Schaltfläche nicht öffnet, kopieren Sie diesen Link:",
    joinAppHint: "Den Link zum Livestream und die Aufzeichnung finden Sie auch in der App Harmonizer — melden Sie sich mit dieser E-Mail an.",
  },
  fr: {
    footer: {
      before:
        "Vous recevez cet e-mail parce que vous avez payé une participation sur le site de Sergei Zamkovoi. Si vous ne souhaitez plus recevoir mes lettres, vous pouvez vous",
      link: "désabonner",
      after: ".",
    },
    joinSubject: (t) => `Le webinaire « ${t} » commence bientôt`,
    joinGreeting: (n) => `Bonjour ${n} !`,
    joinGreetingNoName: "Bonjour !",
    joinBody: (t) => `Le webinaire « ${t} » va bientôt commencer. Rejoignez-le via le lien — je serai heureux de vous voir.`,
    joinButton: "Rejoindre la diffusion",
    joinFallbackLink: "Si le bouton ne s'ouvre pas, copiez ce lien :",
    joinAppHint: "Le lien de la diffusion et l'enregistrement sont aussi dans l'application Harmonizer — connectez-vous avec cet e-mail.",
  },
  it: {
    footer: {
      before:
        "Hai ricevuto questa email perché hai pagato la partecipazione sul sito di Sergei Zamkovoi. Se non vuoi più ricevere le mie newsletter, puoi",
      link: "disiscriverti",
      after: ".",
    },
    joinSubject: (t) => `Il webinar «${t}» inizia a breve`,
    joinGreeting: (n) => `Ciao ${n}!`,
    joinGreetingNoName: "Ciao!",
    joinBody: (t) => `Il webinar «${t}» sta per iniziare. Collegati tramite il link: sarò felice di vederti.`,
    joinButton: "Vai alla diretta",
    joinFallbackLink: "Se il pulsante non si apre, copia questo link:",
    joinAppHint: "Il link alla diretta e la registrazione sono anche nell'app Harmonizer: accedi con questa email.",
  },
  es: {
    footer: {
      before:
        "Recibes este correo porque pagaste la participación en el sitio web de Sergei Zamkovoi. Si ya no quieres recibir mis correos, puedes",
      link: "darte de baja",
      after: ".",
    },
    joinSubject: (t) => `El webinar «${t}» empieza pronto`,
    joinGreeting: (n) => `¡Hola, ${n}!`,
    joinGreetingNoName: "¡Hola!",
    joinBody: (t) => `El webinar «${t}» está a punto de empezar. Conéctate con el enlace: me alegrará verte.`,
    joinButton: "Ir a la transmisión",
    joinFallbackLink: "Si el botón no se abre, copia este enlace:",
    joinAppHint: "El enlace a la transmisión y la grabación también están en la app Harmonizer: inicia sesión con este correo.",
  },
  pt: {
    footer: {
      before:
        "Recebeu este e-mail porque pagou a participação no site de Sergei Zamkovoi. Se já não quiser receber as minhas mensagens, pode",
      link: "cancelar a subscrição",
      after: ".",
    },
    joinSubject: (t) => `O webinar «${t}» começa em breve`,
    joinGreeting: (n) => `Olá, ${n}!`,
    joinGreetingNoName: "Olá!",
    joinBody: (t) => `O webinar «${t}» está prestes a começar. Entre pelo link — terei todo o gosto em vê-lo.`,
    joinButton: "Ir para a transmissão",
    joinFallbackLink: "Se o botão não abrir, copie este link:",
    joinAppHint: "O link da transmissão e a gravação também estão na app Harmonizer — entre com este e-mail.",
  },
  nl: {
    footer: {
      before:
        "Je ontvangt deze e-mail omdat je op de website van Sergei Zamkovoi voor deelname hebt betaald. Wil je mijn nieuwsbrieven niet meer ontvangen, dan kun je je",
      link: "afmelden",
      after: ".",
    },
    joinSubject: (t) => `Het webinar ‘${t}’ begint binnenkort`,
    joinGreeting: (n) => `Hallo ${n}!`,
    joinGreetingNoName: "Hallo!",
    joinBody: (t) => `Het webinar ‘${t}’ begint zo. Doe mee via de link — ik zie je graag.`,
    joinButton: "Naar de livestream",
    joinFallbackLink: "Werkt de knop niet? Kopieer dan deze link:",
    joinAppHint: "De link naar de livestream en de opname staan ook in de app Harmonizer — log in met dit e-mailadres.",
  },
};

export function getWidgetEmailCopy(locale: string | null | undefined): WidgetEmailCopy {
  return COPY[asWidgetLocale(locale) ?? "ru"];
}
