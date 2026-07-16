/**
 * Локализованное имя приложения и reason-строки разрешений iOS для каждой локали.
 *
 * Используется плагином `expo.locales` (app.config.ts): значения попадают в
 * `<lang>.lproj/InfoPlist.strings` и переопределяют базовые (русские/английские)
 * значения из Info.plist для конкретной локали устройства.
 *
 * В reason-строках используется локализованное имя приложения
 * (RU «Гармонизатор», DE «Harmonisierer» …), чтобы заголовок системного окна
 * (CFBundleDisplayName) и тело причины были на одном языке и с одним именем.
 */
const APP_NAMES = {
  ru: "Гармонизатор",
  en: "Harmonizer",
  de: "Harmonisierer",
  fr: "Harmoniseur",
  it: "Armonizzatore",
  es: "Armonizador",
  pt: "Harmonizador",
  nl: "Harmoniseerder",
};

/**
 * Reason-строки разрешений iOS по локалям. Ключи — имена Info.plist.
 * Источник смысла — русские строки из Info.plist / app.config.
 */
const PERMISSION_STRINGS = {
  ru: {
    NSCameraUsageDescription: "Гармонизатор использует камеру для режимов BIOFEEDBACK.",
    NSMicrophoneUsageDescription: "Гармонизатор использует микрофон для голосовых сообщений в чате.",
    NSBluetoothAlwaysUsageDescription:
      "Гармонизатор использует Bluetooth для подключения совместимых нагрудных пульсометров и получения точных ударов R-R.",
    NSLocationWhenInUseUsageDescription:
      "Гармонизатор использует геолокацию для точного расчёта астрономических окон возможностей — восходов/заходов Солнца, Луны и планет в вашем месте.",
    NSLocationAlwaysUsageDescription:
      "Гармонизатор использует геолокацию для точного расчёта астрономических окон возможностей в вашем месте.",
    NSLocationAlwaysAndWhenInUseUsageDescription:
      "Гармонизатор использует геолокацию для точного расчёта астрономических окон возможностей в вашем месте.",
    NSHealthShareUsageDescription:
      "Гармонизатор читает шаги, тренировки, активные калории и сон, чтобы дать мягкую обратную связь при подытоживании дня.",
    NSHealthUpdateUsageDescription:
      "Гармонизатор не записывает данные здоровья, но iOS требует это описание для возможности HealthKit.",
    NSFaceIDUsageDescription: "Разрешите Гармонизатору использовать ваши биометрические данные Face ID.",
    NSPhotoLibraryUsageDescription:
      "Гармонизатор использует доступ к фото, чтобы вы могли приложить скриншот в поддержку.",
  },
  en: {
    NSCameraUsageDescription: "Harmonizer uses the camera for BIOFEEDBACK modes.",
    NSMicrophoneUsageDescription: "Harmonizer uses the microphone for voice messages in chat.",
    NSBluetoothAlwaysUsageDescription:
      "Harmonizer uses Bluetooth to connect compatible chest heart-rate monitors and capture precise R-R intervals.",
    NSLocationWhenInUseUsageDescription:
      "Harmonizer uses your location to precisely calculate astronomical windows of opportunity — sunrises, sunsets, the Moon and planets at your location.",
    NSLocationAlwaysUsageDescription:
      "Harmonizer uses your location to precisely calculate astronomical windows of opportunity at your location.",
    NSLocationAlwaysAndWhenInUseUsageDescription:
      "Harmonizer uses your location to precisely calculate astronomical windows of opportunity at your location.",
    NSHealthShareUsageDescription:
      "Harmonizer reads steps, workouts, active calories and sleep to give gentle feedback when summarizing your day.",
    NSHealthUpdateUsageDescription:
      "Harmonizer does not write health data, but iOS requires this description for the HealthKit capability.",
    NSFaceIDUsageDescription: "Allow Harmonizer to access your Face ID biometric data.",
    NSPhotoLibraryUsageDescription:
      "Harmonizer uses photo access so you can attach a screenshot to a support request.",
  },
  de: {
    NSCameraUsageDescription: "Harmonisierer verwendet die Kamera für BIOFEEDBACK-Modi.",
    NSMicrophoneUsageDescription: "Harmonisierer verwendet das Mikrofon für Sprachnachrichten im Chat.",
    NSBluetoothAlwaysUsageDescription:
      "Harmonisierer verwendet Bluetooth, um kompatible Brustgurt-Pulsmesser zu verbinden und präzise R-R-Intervalle zu erfassen.",
    NSLocationWhenInUseUsageDescription:
      "Harmonisierer verwendet deinen Standort, um astronomische Gelegenheitsfenster präzise zu berechnen — Sonnenauf- und -untergänge sowie Mond und Planeten an deinem Ort.",
    NSLocationAlwaysUsageDescription:
      "Harmonisierer verwendet deinen Standort, um astronomische Gelegenheitsfenster an deinem Ort präzise zu berechnen.",
    NSLocationAlwaysAndWhenInUseUsageDescription:
      "Harmonisierer verwendet deinen Standort, um astronomische Gelegenheitsfenster an deinem Ort präzise zu berechnen.",
    NSHealthShareUsageDescription:
      "Harmonisierer liest Schritte, Workouts, aktive Kalorien und Schlaf, um dir sanftes Feedback bei der Tageszusammenfassung zu geben.",
    NSHealthUpdateUsageDescription:
      "Harmonisierer schreibt keine Gesundheitsdaten, aber iOS erfordert diese Beschreibung für die HealthKit-Funktion.",
    NSFaceIDUsageDescription: "Erlaube Harmonisierer den Zugriff auf deine Face-ID-Biometriedaten.",
    NSPhotoLibraryUsageDescription:
      "Harmonisierer verwendet den Fotozugriff, damit du einen Screenshot an eine Support-Anfrage anhängen kannst.",
  },
  fr: {
    NSCameraUsageDescription: "Harmoniseur utilise la caméra pour les modes BIOFEEDBACK.",
    NSMicrophoneUsageDescription: "Harmoniseur utilise le microphone pour les messages vocaux dans le chat.",
    NSBluetoothAlwaysUsageDescription:
      "Harmoniseur utilise le Bluetooth pour connecter des moniteurs de fréquence cardiaque compatibles et capturer des intervalles R-R précis.",
    NSLocationWhenInUseUsageDescription:
      "Harmoniseur utilise votre position pour calculer précisément les fenêtres astronomiques d'opportunité — lever, coucher du Soleil, de la Lune et des planètes à votre endroit.",
    NSLocationAlwaysUsageDescription:
      "Harmoniseur utilise votre position pour calculer précisément les fenêtres astronomiques d'opportunité à votre endroit.",
    NSLocationAlwaysAndWhenInUseUsageDescription:
      "Harmoniseur utilise votre position pour calculer précisément les fenêtres astronomiques d'opportunité à votre endroit.",
    NSHealthShareUsageDescription:
      "Harmoniseur lit les pas, les séances, les calories actives et le sommeil pour donner un retour doux lors du bilan de la journée.",
    NSHealthUpdateUsageDescription:
      "Harmoniseur n'écrit pas de données de santé, mais iOS exige cette description pour la fonctionnalité HealthKit.",
    NSFaceIDUsageDescription: "Autorisez Harmoniseur à accéder à vos données biométriques Face ID.",
    NSPhotoLibraryUsageDescription:
      "Harmoniseur utilise l'accès aux photos pour que vous puissiez joindre une capture d'écran à une demande de support.",
  },
  it: {
    NSCameraUsageDescription: "Armonizzatore utilizza la fotocamera per le modalità BIOFEEDBACK.",
    NSMicrophoneUsageDescription: "Armonizzatore utilizza il microfono per i messaggi vocali in chat.",
    NSBluetoothAlwaysUsageDescription:
      "Armonizzatore utilizza il Bluetooth per collegare monitor di frequenza cardiaca compatibili e acquisire intervalli R-R precisi.",
    NSLocationWhenInUseUsageDescription:
      "Armonizzatore utilizza la tua posizione per calcolare con precisione le finestre astronomiche di opportunità — albe, tramonti del Sole, della Luna e dei pianeti nella tua posizione.",
    NSLocationAlwaysUsageDescription:
      "Armonizzatore utilizza la tua posizione per calcolare con precisione le finestre astronomiche di opportunità nella tua posizione.",
    NSLocationAlwaysAndWhenInUseUsageDescription:
      "Armonizzatore utilizza la tua posizione per calcolare con precisione le finestre astronomiche di opportunità nella tua posizione.",
    NSHealthShareUsageDescription:
      "Armonizzatore legge passi, allenamenti, calorie attive e sonno per dare un feedback delicato nel riepilogo della giornata.",
    NSHealthUpdateUsageDescription:
      "Armonizzatore non scrive dati di salute, ma iOS richiede questa descrizione per la funzionalità HealthKit.",
    NSFaceIDUsageDescription: "Consenti ad Armonizzatore di accedere ai tuoi dati biometrici Face ID.",
    NSPhotoLibraryUsageDescription:
      "Armonizzatore utilizza l'accesso alle foto per permetterti di allegare una schermata a una richiesta di supporto.",
  },
  es: {
    NSCameraUsageDescription: "Armonizador utiliza la cámara para los modos BIOFEEDBACK.",
    NSMicrophoneUsageDescription: "Armonizador utiliza el micrófono para los mensajes de voz en el chat.",
    NSBluetoothAlwaysUsageDescription:
      "Armonizador utiliza Bluetooth para conectar monitores de frecuencia cardíaca compatibles y capturar intervalos R-R precisos.",
    NSLocationWhenInUseUsageDescription:
      "Armonizador utiliza tu ubicación para calcular con precisión las ventanas astronómicas de oportunidad — amaneceres, atardeceres del Sol, la Luna y los planetas en tu ubicación.",
    NSLocationAlwaysUsageDescription:
      "Armonizador utiliza tu ubicación para calcular con precisión las ventanas astronómicas de oportunidad en tu ubicación.",
    NSLocationAlwaysAndWhenInUseUsageDescription:
      "Armonizador utiliza tu ubicación para calcular con precisión las ventanas astronómicas de oportunidad en tu ubicación.",
    NSHealthShareUsageDescription:
      "Armonizador lee pasos, entrenamientos, calorías activas y sueño para dar una retroalimentación suave al resumir tu día.",
    NSHealthUpdateUsageDescription:
      "Armonizador no escribe datos de salud, pero iOS requiere esta descripción para la funcionalidad HealthKit.",
    NSFaceIDUsageDescription: "Permite a Armonizador acceder a tus datos biométricos de Face ID.",
    NSPhotoLibraryUsageDescription:
      "Armonizador utiliza el acceso a fotos para que puedas adjuntar una captura de pantalla a una solicitud de soporte.",
  },
  pt: {
    NSCameraUsageDescription: "Harmonizador usa a câmera para os modos BIOFEEDBACK.",
    NSMicrophoneUsageDescription: "Harmonizador usa o microfone para mensagens de voz no chat.",
    NSBluetoothAlwaysUsageDescription:
      "Harmonizador usa Bluetooth para conectar monitores de frequência cardíaca compatíveis e capturar intervalos R-R precisos.",
    NSLocationWhenInUseUsageDescription:
      "Harmonizador usa sua localização para calcular com precisão as janelas astronômicas de oportunidade — nascer, pôr do Sol, da Lua e dos planetas em sua localização.",
    NSLocationAlwaysUsageDescription:
      "Harmonizador usa sua localização para calcular com precisão as janelas astronômicas de oportunidade em sua localização.",
    NSLocationAlwaysAndWhenInUseUsageDescription:
      "Harmonizador usa sua localização para calcular com precisão as janelas astronômicas de oportunidade em sua localização.",
    NSHealthShareUsageDescription:
      "Harmonizador lê passos, treinos, calorias ativas e sono para dar um feedback suave ao resumir seu dia.",
    NSHealthUpdateUsageDescription:
      "Harmonizador não grava dados de saúde, mas o iOS exige esta descrição para a funcionalidade HealthKit.",
    NSFaceIDUsageDescription: "Permita que o Harmonizador acesse seus dados biométricos do Face ID.",
    NSPhotoLibraryUsageDescription:
      "Harmonizador usa o acesso a fotos para que você possa anexar uma captura de tela a uma solicitação de suporte.",
  },
  nl: {
    NSCameraUsageDescription: "Harmoniseerder gebruikt de camera voor BIOFEEDBACK-modi.",
    NSMicrophoneUsageDescription: "Harmoniseerder gebruikt de microfoon voor gesproken berichten in de chat.",
    NSBluetoothAlwaysUsageDescription:
      "Harmoniseerder gebruikt Bluetooth om compatibele borst-hartslagmeters te verbinden en nauwkeurige R-R-intervallen vast te leggen.",
    NSLocationWhenInUseUsageDescription:
      "Harmoniseerder gebruikt je locatie om astronomische kansvensters nauwkeurig te berekenen — zonsop- en -ondergangen en de Maan en planeten op jouw plek.",
    NSLocationAlwaysUsageDescription:
      "Harmoniseerder gebruikt je locatie om astronomische kansvensters op jouw plek nauwkeurig te berekenen.",
    NSLocationAlwaysAndWhenInUseUsageDescription:
      "Harmoniseerder gebruikt je locatie om astronomische kansvensters op jouw plek nauwkeurig te berekenen.",
    NSHealthShareUsageDescription:
      "Harmoniseerder leest stappen, trainingen, actieve calorieën en slaap om zachte feedback te geven bij de samenvatting van je dag.",
    NSHealthUpdateUsageDescription:
      "Harmoniseerder schrijft geen gezondheidsgegevens, maar iOS vereist deze beschrijving voor de HealthKit-functie.",
    NSFaceIDUsageDescription: "Sta Harmoniseerder toe toegang te krijgen tot je Face ID-biometrische gegevens.",
    NSPhotoLibraryUsageDescription:
      "Harmoniseerder gebruikt foto-toegang zodat je een schermafbeelding aan een supportverzoek kunt toevoegen.",
  },
};

const LANGS = Object.keys(APP_NAMES);

/** Готовая карта `expo.locales`: ios (CFBundleDisplayName + reason-строки) + android (app_name). */
const locales = {};
for (const lang of LANGS) {
  locales[lang] = {
    ios: {
      CFBundleDisplayName: APP_NAMES[lang],
      ...PERMISSION_STRINGS[lang],
    },
    android: {
      app_name: APP_NAMES[lang],
    },
  };
}

module.exports = { locales, LANGS, APP_NAMES, PERMISSION_STRINGS };
