// Auto-generated from templates/*.json — embedded to avoid JSON import syntax issues in Supabase Edge Functions.
// Название приложения и кнопки «Что делать?» вшиты прямо в текст каждого шаблона (без плейсхолдеров):
// текст письма целиком на одном языке, поэтому {app}/{cta} подстановка в рантайме не нужна.
// Имя отправителя и подпись: RU «Сергей Замковой», во всех остальных — «Sergei Zamkovoi» (см. index.ts).

export interface EmailTemplate {
  subject: string;
  greeting: string;
  intro: string;
  expiry: string;
  ignore: string;
  guideTitle: string;
  guide1: string;
  guide2: string;
  guide3: string;
  guide4: string;
  guide5: string;
  closing: string;
}

export const TEMPLATES: Record<string, EmailTemplate> = {
  ru: {
    subject: '{code} — ваш код входа в Гармонизатор',
    greeting: 'Здравствуйте!',
    intro: 'Ваш код для входа в приложение «Гармонизатор»:',
    expiry: 'Код действует 60 минут и работает только один раз.',
    ignore: 'Если вы не запрашивали код, просто проигнорируйте это письмо.',
    guideTitle: 'Краткое руководство пользователя:',
    guide1: 'Запустите «Гармонизатор» и ознакомьтесь с рекомендациями на день.',
    guide2: 'Нажмите кнопку «Что делать?», чтобы перейти к конкретике и практикам.',
    guide3: 'Следуйте советам, практикуйте, и по отчётам отслеживайте свои успехи.',
    guide4: 'Задавайте мне вопросы на еженедельных вебинарах, чтобы не буксовать.',
    guide5: 'Наслаждайтесь, восхищайтесь, проявляйтесь… :)',
    closing: 'Всех благ!',
  },
  en: {
    subject: '{code} — your Harmonizer sign-in code',
    greeting: 'Hello!',
    intro: 'Your code to sign in to the Harmonizer app:',
    expiry: 'The code is valid for 60 minutes and can be used only once.',
    ignore: 'If you didn\'t request this code, just ignore this email.',
    guideTitle: 'Quick user guide:',
    guide1: 'Open Harmonizer and explore the daily recommendations.',
    guide2: 'Tap the What to do? button to dive into the practices.',
    guide3: 'Follow the guidance, practice, and track your progress with reports.',
    guide4: 'Ask me questions at the weekly webinars so you don\'t get stuck.',
    guide5: 'Enjoy, be amazed, express yourself… :)',
    closing: 'All the best!',
  },
  de: {
    subject: '{code} — Ihr Anmeldecode für Harmonisierer',
    greeting: 'Guten Tag!',
    intro: 'Ihr Anmeldecode für die App „Harmonisierer“:',
    expiry: 'Der Code ist 60 Minuten gültig und kann nur einmal verwendet werden.',
    ignore: 'Falls Sie diesen Code nicht angefordert haben, ignorieren Sie diese E-Mail einfach.',
    guideTitle: 'Kurzanleitung:',
    guide1: 'Starte «Harmonisierer» und schau dir die Tagesempfehlungen an.',
    guide2: 'Klicken Sie auf „Was tun?“, um zu den konkreten Inhalten und Übungen zu gelangen.',
    guide3: 'Folge den Ratschlägen, übe und verfolge deine Fortschritte anhand der Berichte.',
    guide4: 'Stell mir in den wöchentlichen Webinaren Fragen, damit du nicht stecken bleibst.',
    guide5: 'Genieße, bewundere, zeige dich … :)',
    closing: 'Alles Gute!',
  },
  fr: {
    subject: '{code} — votre code de connexion Harmoniseur',
    greeting: 'Bonjour !',
    intro: 'Votre code de connexion à l\'application «Harmoniseur»:',
    expiry: 'Le code est valable 60 minutes et ne peut être utilisé qu\'une seule fois.',
    ignore: 'Si vous n\'avez pas demandé ce code, ignorez simplement cet e-mail.',
    guideTitle: 'Guide rapide de l\'utilisateur :',
    guide1: 'Lancez «Harmoniseur» et découvrez les recommandations du jour.',
    guide2: 'Appuyez sur le bouton «Que faire ?» pour accéder aux détails et aux pratiques.',
    guide3: 'Suivez les conseils, pratiquez et suivez vos progrès dans les rapports.',
    guide4: 'Posez-moi vos questions lors des webinaires hebdomadaires pour ne pas rester bloqué.',
    guide5: 'Profitez, émerveillez-vous, exprimez-vous… :)',
    closing: 'Bien à vous !',
  },
  it: {
    subject: '{code} — il tuo codice di accesso a Armonizzatore',
    greeting: 'Ciao!',
    intro: 'Il tuo codice per accedere all\'app «Armonizzatore»:',
    expiry: 'Il codice è valido per 60 minuti e può essere usato una sola volta.',
    ignore: 'Se non hai richiesto questo codice, ignora semplicemente questa email.',
    guideTitle: 'Breve guida per l\'utente:',
    guide1: 'Avvia «Armonizzatore» e consulta i consigli del giorno.',
    guide2: 'Clicca il pulsante «Cosa fare?» per passare ai dettagli e alle pratiche.',
    guide3: 'Segui i consigli, pratica e monitora i tuoi progressi attraverso i report.',
    guide4: 'Fammi domande durante i webinar settimanali per non rimanere bloccato.',
    guide5: 'Goditi, meravigliati, esprimiti… :)',
    closing: 'Ti auguro ogni bene!',
  },
  es: {
    subject: '{code} — tu código de acceso a Armonizador',
    greeting: '¡Hola!',
    intro: 'Tu código para iniciar sesión en «Armonizador»:',
    expiry: 'El código es válido durante 60 minutos y solo puede usarse una vez.',
    ignore: 'Si no solicitaste este código, simplemente ignora este correo.',
    guideTitle: 'Breve guía de usuario:',
    guide1: 'Abre «Armonizador» y consulta las recomendaciones del día.',
    guide2: 'Haz clic en el botón «¿Qué hacer?» para pasar a lo concreto y las prácticas.',
    guide3: 'Sigue los consejos, practica y sigue tu progreso con los informes.',
    guide4: 'Hazme preguntas en los seminarios web semanales para no quedarte estancado.',
    guide5: 'Disfruta, maravíllate, manifiéstate… :)',
    closing: '¡Todo lo mejor!',
  },
  pt: {
    subject: '{code} — o seu código de acesso ao Harmonizador',
    greeting: 'Olá!',
    intro: 'Seu código de acesso ao app «Harmonizador»:',
    expiry: 'O código é válido por 60 minutos e só pode ser usado uma vez.',
    ignore: 'Se não pediu este código, ignore este e-mail.',
    guideTitle: 'Guia rápido do usuário:',
    guide1: 'Abra o Harmonizador e confira as recomendações do dia.',
    guide2: 'Clique no botão «O que fazer?» para acessar os detalhes e as práticas.',
    guide3: 'Siga os conselhos, pratique e acompanhe seus progressos pelos relatórios.',
    guide4: 'Faça-me perguntas nos webinars semanais para não travar.',
    guide5: 'Desfrute, admire, expresse-se… :)',
    closing: 'Tudo de bom!',
  },
  nl: {
    subject: '{code} — je inlogcode voor Harmoniseerder',
    greeting: 'Hallo!',
    intro: 'Je inlogcode voor de app «Harmoniseerder»:',
    expiry: 'De code is 60 minuten geldig en kan maar één keer worden gebruikt.',
    ignore: 'Heb je deze code niet aangevraagd? Negeer deze e-mail dan gewoon.',
    guideTitle: 'Korte gebruikershandleiding:',
    guide1: 'Start «Harmoniseerder» en bekijk de aanbevelingen voor vandaag.',
    guide2: 'Klik op de knop «Wat te doen?» om naar de specifieke inhoud en oefeningen te gaan.',
    guide3: 'Volg de adviezen, oefen, en volg je voortgang via de rapporten.',
    guide4: 'Stel mij vragen tijdens de wekelijkse webinars om niet vast te lopen.',
    guide5: 'Geniet, bewonder, manifesteer je… :)',
    closing: 'Al het goede!',
  },
};

export const DEFAULT_LOCALE = "ru";
