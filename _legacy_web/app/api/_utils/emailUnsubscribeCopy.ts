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
};

const COPY: Record<AppContentLocale, Omit<UnsubscribePageCopy, "lang">> = {
  ru: {
    successTitle: "Вы отписались",
    successBody:
      "Мы больше не будем присылать маркетинговые письма на этот адрес. Доступ к приложению не изменился.",
    invalidTitle: "Ссылка недействительна",
    invalidBody: "Проверьте ссылку из письма или запросите новую.",
  },
  en: {
    successTitle: "You’re unsubscribed",
    successBody:
      "We won’t send marketing emails to this address anymore. Your app access is unchanged.",
    invalidTitle: "This link isn’t valid",
    invalidBody: "Check the link from the email, or request a new one.",
  },
  de: {
    successTitle: "Abmeldung bestätigt",
    successBody:
      "Wir senden keine Marketing-E-Mails mehr an diese Adresse. Der Zugang zur App bleibt unverändert.",
    invalidTitle: "Link ungültig",
    invalidBody: "Prüfen Sie den Link aus der E-Mail oder fordern Sie einen neuen an.",
  },
  fr: {
    successTitle: "Désabonnement confirmé",
    successBody:
      "Nous n’enverrons plus d’e-mails marketing à cette adresse. L’accès à l’application ne change pas.",
    invalidTitle: "Lien invalide",
    invalidBody: "Vérifiez le lien du message ou demandez-en un nouveau.",
  },
  it: {
    successTitle: "Iscrizione annullata",
    successBody:
      "Non invieremo più email di marketing a questo indirizzo. L’accesso all’app non cambia.",
    invalidTitle: "Link non valido",
    invalidBody: "Controlla il link nell’email oppure richiedine uno nuovo.",
  },
  es: {
    successTitle: "Baja confirmada",
    successBody:
      "Ya no enviaremos correos de marketing a esta dirección. El acceso a la aplicación no cambia.",
    invalidTitle: "Enlace no válido",
    invalidBody: "Revisa el enlace del correo o solicita uno nuevo.",
  },
  pt: {
    successTitle: "Inscrição cancelada",
    successBody:
      "Não enviaremos mais e-mails de marketing para este endereço. O acesso ao aplicativo não muda.",
    invalidTitle: "Link inválido",
    invalidBody: "Verifique o link do e-mail ou solicite um novo.",
  },
  nl: {
    successTitle: "Uitgeschreven",
    successBody:
      "We sturen geen marketingmails meer naar dit adres. Toegang tot de app blijft hetzelfde.",
    invalidTitle: "Ongeldige link",
    invalidBody: "Controleer de link in de e-mail of vraag een nieuwe aan.",
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
