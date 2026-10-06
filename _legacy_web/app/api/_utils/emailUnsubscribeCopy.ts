/**
 * Confirmation page for marketing opt-out (standalone HTML, not Expo catalog).
 * Russian is the authoring source; all 8 content locales are explicit.
 */

import {
  asContentLocale,
  type AppContentLocale,
} from "./contentLocales";

export type UnsubscribePageCopy = {
  lang: AppContentLocale;
  successTitle: string;
  successBody: string;
  invalidTitle: string;
  invalidBody: string;
  temporaryTitle: string;
  temporaryBody: string;
};

const COPY: Record<AppContentLocale, Omit<UnsubscribePageCopy, "lang">> = {
  ru: {
    successTitle: "Вы отписаны",
    successBody: "Я больше не буду отправлять вам подобные письма.",
    invalidTitle: "Ссылка недействительна",
    invalidBody: "Проверьте ссылку из письма или запросите новую.",
    temporaryTitle: "Не получилось отписать",
    temporaryBody: "Сервер на секунду не ответил. Откройте ссылку из письма ещё раз.",
  },
  en: {
    successTitle: "You’re unsubscribed",
    successBody: "I won’t send you emails like this anymore.",
    invalidTitle: "This link isn’t valid",
    invalidBody: "Check the link from the email, or request a new one.",
    temporaryTitle: "Couldn’t unsubscribe just now",
    temporaryBody: "The server didn’t answer. Open the link from the email once more.",
  },
  de: {
    successTitle: "Sie sind abgemeldet",
    successBody: "Ich werde Ihnen solche E-Mails nicht mehr schicken.",
    invalidTitle: "Link ungültig",
    invalidBody: "Prüfen Sie den Link aus der E-Mail oder fordern Sie einen neuen an.",
    temporaryTitle: "Abmeldung gerade nicht möglich",
    temporaryBody: "Der Server hat nicht geantwortet. Öffnen Sie den Link aus der E-Mail noch einmal.",
  },
  fr: {
    successTitle: "Vous êtes désabonné",
    successBody: "Je ne vous enverrai plus de messages de ce type.",
    invalidTitle: "Lien invalide",
    invalidBody: "Vérifiez le lien du message ou demandez-en un nouveau.",
    temporaryTitle: "Désinscription impossible pour l’instant",
    temporaryBody: "Le serveur n’a pas répondu. Ouvrez à nouveau le lien du message.",
  },
  it: {
    successTitle: "Iscrizione annullata",
    successBody: "Non ti invierò più email di questo tipo.",
    invalidTitle: "Link non valido",
    invalidBody: "Controlla il link nell’email oppure richiedine uno nuovo.",
    temporaryTitle: "Disiscrizione non riuscita",
    temporaryBody: "Il server non ha risposto. Apri di nuovo il link nell’email.",
  },
  es: {
    successTitle: "Baja confirmada",
    successBody: "Ya no te enviaré correos como este.",
    invalidTitle: "Enlace no válido",
    invalidBody: "Revisa el enlace del correo o solicita uno nuevo.",
    temporaryTitle: "No se pudo cancelar la suscripción",
    temporaryBody: "El servidor no respondió. Abre otra vez el enlace del correo.",
  },
  pt: {
    successTitle: "Inscrição cancelada",
    successBody: "Não enviarei mais e-mails como este.",
    invalidTitle: "Link inválido",
    invalidBody: "Verifique o link do e-mail ou solicite um novo.",
    temporaryTitle: "Não foi possível cancelar a inscrição",
    temporaryBody: "O servidor não respondeu. Abra de novo o link do e-mail.",
  },
  nl: {
    successTitle: "Je bent uitgeschreven",
    successBody: "Ik stuur je dit soort e-mails niet meer.",
    invalidTitle: "Ongeldige link",
    invalidBody: "Controleer de link in de e-mail of vraag een nieuwe aan.",
    temporaryTitle: "Afmelden lukt nu niet",
    temporaryBody: "De server antwoordde niet. Open de link in de e-mail nog een keer.",
  },
};

export function localeFromAcceptLanguage(header: string | null | undefined): AppContentLocale {
  const raw = (header ?? "").split(",")[0]?.trim() ?? "";
  const tag = raw.split(";")[0]?.trim() ?? "";
  return asContentLocale(tag) ?? "ru";
}

export function getUnsubscribePageCopy(
  locale: string | null | undefined,
): UnsubscribePageCopy {
  const lang = asContentLocale(locale) ?? "ru";
  return { lang, ...COPY[lang] };
}
