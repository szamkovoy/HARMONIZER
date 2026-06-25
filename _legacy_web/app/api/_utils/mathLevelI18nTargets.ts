import type { MathLevelStrings } from "./mathLevelI18n";

function fromEn(partial: Omit<MathLevelStrings, "chakraLabel" | "calibratedS" | "calibratedH" | "transitLine" | "orbLine" | "activationLine" | "importanceLine" | "winnerLine" | "alternativeLine" | "calibrationIntro" | "deltaLine" | "globalPetalLine" | "globalWinnerLine" | "globalRankingLine" | "globalAspectLine" | "globalAspectWeightLine"> & {
  chakraLabel: string;
  calibratedS: string;
  calibratedH: string;
  transitLine: string;
  orbLine: string;
  activationLine: string;
  importanceLine: string;
  winnerLine: string;
  alternativeLine: string;
  calibrationIntro: string;
  deltaLine: string;
  globalPetalLine: string;
  globalWinnerLine: string;
  globalRankingLine: string;
  globalAspectLine: string;
  globalAspectWeightLine: string;
}): MathLevelStrings {
  return {
    ...partial,
    chakraLabel: (n) => partial.chakraLabel.replace("{n}", String(n)),
    calibratedS: (value, delta) => partial.calibratedS.replace("{value}", value).replace("{delta}", delta),
    calibratedH: (value, delta) => partial.calibratedH.replace("{value}", value).replace("{delta}", delta),
    transitLine: (transit, aspect, natal) =>
      partial.transitLine.replace("{transit}", transit).replace("{aspect}", aspect).replace("{natal}", natal),
    orbLine: (orb, coef, weight) =>
      partial.orbLine.replace("{orb}", orb).replace("{coef}", coef).replace("{weight}", weight),
    activationLine: (value) => partial.activationLine.replace("{value}", value),
    importanceLine: (planet, activation, sEff, importance) =>
      partial.importanceLine
        .replace("{planet}", planet)
        .replace("{activation}", activation)
        .replace("{sEff}", sEff)
        .replace("{importance}", importance),
    winnerLine: (planet, importance) =>
      partial.winnerLine.replace("{planet}", planet).replace("{importance}", importance),
    alternativeLine: (reason) => partial.alternativeLine.replace("{reason}", reason),
    calibrationIntro: (version, source, blend) =>
      partial.calibrationIntro.replace("{version}", version).replace("{source}", source).replace("{blend}", blend),
    deltaLine: (planet, dS, dH) => partial.deltaLine.replace("{planet}", planet).replace("{dS}", dS).replace("{dH}", dH),
    globalPetalLine: (planet, gravity, chakra, tone) =>
      partial.globalPetalLine
        .replace("{planet}", planet)
        .replace("{gravity}", String(gravity))
        .replace("{chakra}", String(chakra))
        .replace("{tone}", tone),
    globalWinnerLine: (planet, chakra, tone, gravity) =>
      partial.globalWinnerLine
        .replace("{planet}", planet)
        .replace("{chakra}", String(chakra))
        .replace("{tone}", tone)
        .replace("{gravity}", gravity),
    globalRankingLine: (rank, planet, sign, degree, gravity, tone) =>
      partial.globalRankingLine
        .replace("{rank}", rank)
        .replace("{planet}", planet)
        .replace("{sign}", sign)
        .replace("{degree}", degree)
        .replace("{gravity}", gravity)
        .replace("{tone}", tone),
    globalAspectLine: (from, type, to, orb) =>
      partial.globalAspectLine.replace("{from}", from).replace("{type}", type).replace("{to}", to).replace("{orb}", orb),
    globalAspectWeightLine: (from, type, to, orb, weight) =>
      partial.globalAspectWeightLine
        .replace("{from}", from)
        .replace("{type}", type)
        .replace("{to}", to)
        .replace("{orb}", orb)
        .replace("{weight}", weight),
  };
}

export const mathLevelIt: MathLevelStrings = fromEn({
  title: "## Matematica del giorno\n",
  intro:
    "Qui trovi il calcolo esatto di ciò che vedi nella schermata principale. Usiamo metodi dell'astrologia greca antica (dignità essenziali di Tolomeo, accidentali di Lilly), adattati al modello psicologico moderno dei chakra.\n",
  section1Title: "\n### 1. Forza (S) e armonia (H) planetaria\n",
  formulaS: "**Formula S:** combinazione di dignità essenziali e fattori accidentali, normalizzata in [0, 1].\n",
  formulaH: "**Formula H:** somma ponderata di fattori armonizzanti e tesi, normalizzata in [-1, +1].\n",
  chakraLabel: "(chakra {n})",
  natalS: "S natal",
  natalH: "H natal",
  calibratedS: "S calibrata: {value} (Δ{delta})",
  calibratedH: "H calibrata: {value} (Δ{delta})",
  section2Title: "\n### 2. Transiti attivanti oggi\n",
  section2Intro:
    "Quando un pianeta in transito forma un aspetto con uno natale, attiva quel tema per la giornata. Il peso del transito dipende dalla velocità, dall'orbe e dal tipo di aspetto.\n",
  transitLine: "\n- **{transit}** in transito {aspect} al natal **{natal}**",
  orbLine: "  - Orbe: {orb}°, coeff. aspetto: {coef}, peso transito: {weight}",
  activationLine: "  - Attivazione: {value}",
  noTransitChart: "\nLa previsione salvata non contiene la carta di transito, quindi gli aspetti non sono disponibili.",
  section3Title: "\n### 3. Importance — formula del pianeta del giorno\n",
  section3Formula: "**Importance(P) = Activation(P) × (0.5 + 0.5 × S_eff(P))**\n",
  section3Intro:
    "Dove `Activation` è il peso totale dei transiti attivanti; `S_eff` è la forza effettiva (S_calibrated se c'è calibrazione, altrimenti S_initial).\n",
  importanceLine: "- **{planet}**: Activation={activation} × (0.5 + 0.5 × {sEff}) = **{importance}**",
  section4Title: "\n### 4. Scelta del pianeta del giorno",
  winnerLine: "Vincitore: **{planet}** (Importance = {importance}).\n",
  alternativeLine: "Scelta alternativa usata: {reason}.",
  section5Title: "\n### 5. Delta di calibrazione\n",
  calibrationIntro: "Calibrazione v{version}, fonte: {source}. Media applicata: {blend}.\n",
  deltaLine: "- {planet}: ΔS={dS}, ΔH={dH}",
  globalTitle: "## Matematica della previsione globale\n",
  globalIntro:
    "La previsione globale è costruita senza carta natale: si usano solo le posizioni di transito delle sette pianeti alle 12:00 UTC del giorno scelto.",
  globalSectionPetals: "\n### Top 3 petali\n",
  globalPetalLine: "- **{planet}**: gravity={gravity}, chakra {chakra}, tone={tone}",
  globalMechanicsLine:
    "Ogni pianeta riceve un punteggio gravity: sommiamo i contributi degli aspetti corretti per tipo di aspetto, precisione dell'orbe e peso del pianeta in transito.",
  globalSectionWinner: "\n### Perché questo è il tema del giorno\n",
  globalWinnerLine:
    "- Tema principale del giorno: **{planet}** (chakra {chakra}, tone={tone}, gravity={gravity}). È il pianeta con il peso complessivo più alto tra i transiti di oggi.",
  globalSectionRanking: "\n### Classifica completa dei pianeti in questo momento\n",
  globalRankingLine:
    "{rank}. **{planet}** — {sign} {degree}°, gravity={gravity}, tone={tone}",
  globalSectionAspects: "\n### Aspetti attivi del giorno\n",
  globalAspectLine: "- {from} {type} {to}, orbe={orb}°",
  globalSectionAspectWeights: "\n### Peso di ogni aspetto nel quadro complessivo\n",
  globalAspectWeightLine: "- {from} {type} {to}: orbe={orb}°, contributo={weight}",
});

export const mathLevelDe: MathLevelStrings = fromEn({
  title: "## Tagesmathematik\n",
  intro:
    "Hier ist die exakte Berechnung hinter dem, was du auf dem Startbildschirm siehst. Wir nutzen Methoden der antiken griechischen Astrologie (Ptolemäus' essenzielle Würden, Lillys Akzidentien), angepasst an das moderne Chakra-Psychologiemodell.\n",
  section1Title: "\n### 1. Planetenstärke (S) und Harmonie (H)\n",
  formulaS: "**Formel S:** Kombination essenzieller Würden und akzidenteller Faktoren, normalisiert auf [0, 1].\n",
  formulaH: "**Formel H:** gewichtete Summe harmonisierender und spannungsvoller Faktoren, normalisiert auf [-1, +1].\n",
  chakraLabel: "(Chakra {n})",
  natalS: "natal S",
  natalH: "natal H",
  calibratedS: "kalibriertes S: {value} (Δ{delta})",
  calibratedH: "kalibriertes H: {value} (Δ{delta})",
  section2Title: "\n### 2. Aktivierende Transite heute\n",
  section2Intro:
    "Wenn ein Transitplanet einen Natalaspekt bildet, aktiviert er dieses Thema für den Tag. Das Transitgewicht hängt von Geschwindigkeit, Orbe und Aspekttyp ab.\n",
  transitLine: "\n- Transit **{transit}** {aspect} Natal **{natal}**",
  orbLine: "  - Orbe: {orb}°, Aspektkoeff.: {coef}, Transitgewicht: {weight}",
  activationLine: "  - Aktivierung: {value}",
  noTransitChart: "\nDie gespeicherte Prognose enthält keine Transitkarte; Aspekte sind nicht verfügbar.",
  section3Title: "\n### 3. Importance — Formel für den Tagesplaneten\n",
  section3Formula: "**Importance(P) = Activation(P) × (0.5 + 0.5 × S_eff(P))**\n",
  section3Intro:
    "Dabei ist `Activation` die Gesamtgewichtung aktivierender Transite; `S_eff` die effektive Stärke (S_calibrated bei Kalibrierung, sonst S_initial).\n",
  importanceLine: "- **{planet}**: Activation={activation} × (0.5 + 0.5 × {sEff}) = **{importance}**",
  section4Title: "\n### 4. Tagesplanet",
  winnerLine: "Gewinner: **{planet}** (Importance = {importance}).\n",
  alternativeLine: "Alternative Wahl verwendet: {reason}.",
  section5Title: "\n### 5. Kalibrierungsdeltas\n",
  calibrationIntro: "Kalibrierung v{version}, Quelle: {source}. Angewandte Mischung: {blend}.\n",
  deltaLine: "- {planet}: ΔS={dS}, ΔH={dH}",
  globalTitle: "## Mathematik der globalen Prognose\n",
  globalIntro:
    "Die globale Prognose wird ohne Natalchart erstellt: nur Transitpositionen der sieben Planeten um 12:00 UTC des gewählten Tages.",
  globalSectionPetals: "\n### Top-3-Blütenblätter\n",
  globalPetalLine: "- **{planet}**: gravity={gravity}, Chakra {chakra}, tone={tone}",
  globalMechanicsLine:
    "Jeder Planet erhält einen Gravity-Wert: Beiträge der Aspekte werden nach Aspekttyp, Orbengenauigkeit und Gewicht des Transitplaneten summiert.",
  globalSectionWinner: "\n### Warum daraus das Tagesthema wurde\n",
  globalWinnerLine:
    "- Hauptthema des Tages: **{planet}** (Chakra {chakra}, tone={tone}, gravity={gravity}). Dieser Planet erhielt unter den heutigen Transiten das höchste Gesamtgewicht.",
  globalSectionRanking: "\n### Vollständiges Planeten-Ranking für diesen Moment\n",
  globalRankingLine:
    "{rank}. **{planet}** — {sign} {degree}°, gravity={gravity}, tone={tone}",
  globalSectionAspects: "\n### Aktive Aspekte des Tages\n",
  globalAspectLine: "- {from} {type} {to}, Orbe={orb}°",
  globalSectionAspectWeights: "\n### Gewicht jedes Aspekts im Gesamtbild\n",
  globalAspectWeightLine: "- {from} {type} {to}: Orbe={orb}°, Beitrag={weight}",
});

export const mathLevelFr: MathLevelStrings = fromEn({
  title: "## Mathématiques du jour\n",
  intro:
    "Voici le calcul exact derrière ce que vous voyez sur l'écran d'accueil. Nous utilisons l'astrologie grecque antique (dignités essentielles de Ptolémée, accidentelles de Lilly), adaptée au modèle psychologique moderne des chakras.\n",
  section1Title: "\n### 1. Force (S) et harmonie (H) planétaires\n",
  formulaS: "**Formule S :** combinaison de dignités essentielles et de facteurs accidentels, normalisée sur [0, 1].\n",
  formulaH: "**Formule H :** somme pondérée de facteurs harmonisants et tendus, normalisée sur [-1, +1].\n",
  chakraLabel: "(chakra {n})",
  natalS: "S natal",
  natalH: "H natal",
  calibratedS: "S calibré : {value} (Δ{delta})",
  calibratedH: "H calibré : {value} (Δ{delta})",
  section2Title: "\n### 2. Transits activateurs aujourd'hui\n",
  section2Intro:
    "Quand une planète en transit aspecte une planète natale, elle active ce thème pour la journée. Le poids du transit dépend de la vitesse, de l'orbe et du type d'aspect.\n",
  transitLine: "\n- **{transit}** en transit {aspect} au natal **{natal}**",
  orbLine: "  - Orbe : {orb}°, coeff. aspect : {coef}, poids transit : {weight}",
  activationLine: "  - Activation : {value}",
  noTransitChart: "\nLa prévision enregistrée n'a pas de carte de transit ; les aspects sont indisponibles.",
  section3Title: "\n### 3. Importance — formule de la planète du jour\n",
  section3Formula: "**Importance(P) = Activation(P) × (0.5 + 0.5 × S_eff(P))**\n",
  section3Intro:
    "Où `Activation` est le poids total des transits activateurs ; `S_eff` est la force effective (S_calibrated si calibration, sinon S_initial).\n",
  importanceLine: "- **{planet}** : Activation={activation} × (0.5 + 0.5 × {sEff}) = **{importance}**",
  section4Title: "\n### 4. Planète du jour",
  winnerLine: "Gagnante : **{planet}** (Importance = {importance}).\n",
  alternativeLine: "Choix alternatif utilisé : {reason}.",
  section5Title: "\n### 5. Deltas de calibration\n",
  calibrationIntro: "Calibration v{version}, source : {source}. Mélange appliqué : {blend}.\n",
  deltaLine: "- {planet} : ΔS={dS}, ΔH={dH}",
  globalTitle: "## Mathématiques de la prévision globale\n",
  globalIntro:
    "La prévision globale est construite sans thème natal : seules les positions de transit des sept planètes à 12:00 UTC du jour choisi.",
  globalSectionPetals: "\n### Top 3 pétales\n",
  globalPetalLine: "- **{planet}** : gravity={gravity}, chakra {chakra}, tone={tone}",
  globalMechanicsLine:
    "Chaque planète reçoit un score gravity : on additionne les contributions des aspects selon le type d'aspect, la précision de l'orbe et le poids de la planète en transit.",
  globalSectionWinner: "\n### Pourquoi ce thème a été retenu pour la journée\n",
  globalWinnerLine:
    "- Thème principal du jour : **{planet}** (chakra {chakra}, tone={tone}, gravity={gravity}). C'est la planète qui a reçu le poids total le plus élevé parmi les transits du jour.",
  globalSectionRanking: "\n### Classement complet des planètes à cet instant\n",
  globalRankingLine:
    "{rank}. **{planet}** — {sign} {degree}°, gravity={gravity}, tone={tone}",
  globalSectionAspects: "\n### Aspects actifs du jour\n",
  globalAspectLine: "- {from} {type} {to}, orbe={orb}°",
  globalSectionAspectWeights: "\n### Poids de chaque aspect dans l'ensemble\n",
  globalAspectWeightLine: "- {from} {type} {to} : orbe={orb}°, contribution={weight}",
});

export const mathLevelEs: MathLevelStrings = fromEn({
  title: "## Matemáticas del día\n",
  intro:
    "Aquí está el cálculo exacto de lo que ves en la pantalla principal. Usamos métodos de la astrología griega antigua (dignidades esenciales de Ptolomeo, accidentales de Lilly), adaptados al modelo psicológico moderno de los chakras.\n",
  section1Title: "\n### 1. Fuerza (S) y armonía (H) planetaria\n",
  formulaS: "**Fórmula S:** combinación de dignidades esenciales y factores accidentales, normalizada a [0, 1].\n",
  formulaH: "**Fórmula H:** suma ponderada de factores armonizadores y tensos, normalizada a [-1, +1].\n",
  chakraLabel: "(chakra {n})",
  natalS: "S natal",
  natalH: "H natal",
  calibratedS: "S calibrada: {value} (Δ{delta})",
  calibratedH: "H calibrada: {value} (Δ{delta})",
  section2Title: "\n### 2. Tránsitos activadores hoy\n",
  section2Intro:
    "Cuando un planeta en tránsito aspecta uno natal, activa ese tema durante el día. El peso del tránsito depende de la velocidad, el orbe y el tipo de aspecto.\n",
  transitLine: "\n- **{transit}** en tránsito {aspect} al natal **{natal}**",
  orbLine: "  - Orbe: {orb}°, coef. aspecto: {coef}, peso tránsito: {weight}",
  activationLine: "  - Activación: {value}",
  noTransitChart: "\nLa previsión guardada no tiene carta de tránsito; los aspectos no están disponibles.",
  section3Title: "\n### 3. Importance — fórmula del planeta del día\n",
  section3Formula: "**Importance(P) = Activation(P) × (0.5 + 0.5 × S_eff(P))**\n",
  section3Intro:
    "Donde `Activation` es el peso total de tránsitos activadores; `S_eff` es la fuerza efectiva (S_calibrated si hay calibración, si no S_initial).\n",
  importanceLine: "- **{planet}**: Activation={activation} × (0.5 + 0.5 × {sEff}) = **{importance}**",
  section4Title: "\n### 4. Planeta del día",
  winnerLine: "Ganador: **{planet}** (Importance = {importance}).\n",
  alternativeLine: "Elección alternativa usada: {reason}.",
  section5Title: "\n### 5. Deltas de calibración\n",
  calibrationIntro: "Calibración v{version}, fuente: {source}. Mezcla aplicada: {blend}.\n",
  deltaLine: "- {planet}: ΔS={dS}, ΔH={dH}",
  globalTitle: "## Matemáticas de la previsión global\n",
  globalIntro:
    "La previsión global se construye sin carta natal: solo posiciones de tránsito de los siete planetas a las 12:00 UTC del día elegido.",
  globalSectionPetals: "\n### Top 3 pétalos\n",
  globalPetalLine: "- **{planet}**: gravity={gravity}, chakra {chakra}, tone={tone}",
  globalMechanicsLine:
    "Cada planeta recibe una puntuación gravity: sumamos las contribuciones de los aspectos ajustadas por el tipo de aspecto, la precisión del orbe y el peso del planeta en tránsito.",
  globalSectionWinner: "\n### Por qué este se convirtió en el tema del día\n",
  globalWinnerLine:
    "- Tema principal del día: **{planet}** (chakra {chakra}, tone={tone}, gravity={gravity}). Es el planeta con el mayor peso total entre los tránsitos de hoy.",
  globalSectionRanking: "\n### Clasificación completa de planetas en este momento\n",
  globalRankingLine:
    "{rank}. **{planet}** — {sign} {degree}°, gravity={gravity}, tone={tone}",
  globalSectionAspects: "\n### Aspectos activos del día\n",
  globalAspectLine: "- {from} {type} {to}, orbe={orb}°",
  globalSectionAspectWeights: "\n### Peso de cada aspecto en el conjunto\n",
  globalAspectWeightLine: "- {from} {type} {to}: orbe={orb}°, contribución={weight}",
});

export const mathLevelPt: MathLevelStrings = fromEn({
  title: "## Matemática do dia\n",
  intro:
    "Aqui está o cálculo exato por trás do que você vê na tela inicial. Usamos métodos da astrologia grega antiga (dignidades essenciais de Ptolomeu, acidentais de Lilly), ajustados ao modelo psicológico moderno dos chakras.\n",
  section1Title: "\n### 1. Força (S) e harmonia (H) planetária\n",
  formulaS: "**Fórmula S:** combinação de dignidades essenciais e fatores acidentais, normalizada em [0, 1].\n",
  formulaH: "**Fórmula H:** soma ponderada de fatores harmonizadores e tensos, normalizada em [-1, +1].\n",
  chakraLabel: "(chakra {n})",
  natalS: "S natal",
  natalH: "H natal",
  calibratedS: "S calibrada: {value} (Δ{delta})",
  calibratedH: "H calibrada: {value} (Δ{delta})",
  section2Title: "\n### 2. Trânsitos ativadores hoje\n",
  section2Intro:
    "Quando um planeta em trânsito aspecta um natal, ativa esse tema no dia. O peso do trânsito depende da velocidade, orbe e tipo de aspecto.\n",
  transitLine: "\n- **{transit}** em trânsito {aspect} ao natal **{natal}**",
  orbLine: "  - Orbe: {orb}°, coef. aspecto: {coef}, peso trânsito: {weight}",
  activationLine: "  - Ativação: {value}",
  noTransitChart: "\nA previsão salva não tem mapa de trânsito; aspectos indisponíveis.",
  section3Title: "\n### 3. Importance — fórmula do planeta do dia\n",
  section3Formula: "**Importance(P) = Activation(P) × (0.5 + 0.5 × S_eff(P))**\n",
  section3Intro:
    "Onde `Activation` é o peso total dos trânsitos ativadores; `S_eff` é a força efetiva (S_calibrated se houver calibração, senão S_initial).\n",
  importanceLine: "- **{planet}**: Activation={activation} × (0.5 + 0.5 × {sEff}) = **{importance}**",
  section4Title: "\n### 4. Planeta do dia",
  winnerLine: "Vencedor: **{planet}** (Importance = {importance}).\n",
  alternativeLine: "Escolha alternativa usada: {reason}.",
  section5Title: "\n### 5. Deltas de calibração\n",
  calibrationIntro: "Calibração v{version}, fonte: {source}. Média aplicada: {blend}.\n",
  deltaLine: "- {planet}: ΔS={dS}, ΔH={dH}",
  globalTitle: "## Matemática da previsão global\n",
  globalIntro:
    "A previsão global é construída sem mapa natal: apenas posições de trânsito dos sete planetas às 12:00 UTC do dia escolhido.",
  globalSectionPetals: "\n### Top 3 pétalas\n",
  globalPetalLine: "- **{planet}**: gravity={gravity}, chakra {chakra}, tone={tone}",
  globalMechanicsLine:
    "Cada planeta recebe uma pontuação gravity: somamos as contribuições dos aspectos ajustadas pelo tipo de aspecto, pela precisão do orbe e pelo peso do planeta em trânsito.",
  globalSectionWinner: "\n### Por que este virou o tema do dia\n",
  globalWinnerLine:
    "- Tema principal do dia: **{planet}** (chakra {chakra}, tone={tone}, gravity={gravity}). Foi o planeta com o maior peso total entre os trânsitos de hoje.",
  globalSectionRanking: "\n### Ranking completo dos planetas neste momento\n",
  globalRankingLine:
    "{rank}. **{planet}** — {sign} {degree}°, gravity={gravity}, tone={tone}",
  globalSectionAspects: "\n### Aspectos ativos do dia\n",
  globalAspectLine: "- {from} {type} {to}, orbe={orb}°",
  globalSectionAspectWeights: "\n### Peso de cada aspecto no quadro geral\n",
  globalAspectWeightLine: "- {from} {type} {to}: orbe={orb}°, contribuição={weight}",
});

export const mathLevelNl: MathLevelStrings = fromEn({
  title: "## Dagwiskunde\n",
  intro:
    "Hier is de exacte berekening achter wat je op het startscherm ziet. We gebruiken methoden uit de oude Griekse astrologie (Ptolemaeus' essentiële waardigheid, Lilly's accidentals), aangepast aan het moderne chakra-psychologiemodel.\n",
  section1Title: "\n### 1. Planetenkracht (S) en harmonie (H)\n",
  formulaS: "**Formule S:** combinatie van essentiële waardigheid en accidentele factoren, genormaliseerd naar [0, 1].\n",
  formulaH: "**Formule H:** gewogen som van harmoniserende en spannende factoren, genormaliseerd naar [-1, +1].\n",
  chakraLabel: "(chakra {n})",
  natalS: "natal S",
  natalH: "natal H",
  calibratedS: "gekalibreerd S: {value} (Δ{delta})",
  calibratedH: "gekalibreerd H: {value} (Δ{delta})",
  section2Title: "\n### 2. Activerende transits vandaag\n",
  section2Intro:
    "Wanneer een transitplaneet een natal aspect maakt, activeert dat thema voor de dag. Transitgewicht hangt af van snelheid, orbe en aspecttype.\n",
  transitLine: "\n- Transit **{transit}** {aspect} natal **{natal}**",
  orbLine: "  - Orbe: {orb}°, aspectcoef.: {coef}, transitgewicht: {weight}",
  activationLine: "  - Activatie: {value}",
  noTransitChart: "\nDe opgeslagen voorspelling heeft geen transitkaart; aspecten zijn niet beschikbaar.",
  section3Title: "\n### 3. Importance — formule planeet van de dag\n",
  section3Formula: "**Importance(P) = Activation(P) × (0.5 + 0.5 × S_eff(P))**\n",
  section3Intro:
    "Waarbij `Activation` het totale gewicht van activerende transits is; `S_eff` effectieve kracht (S_calibrated bij kalibratie, anders S_initial).\n",
  importanceLine: "- **{planet}**: Activation={activation} × (0.5 + 0.5 × {sEff}) = **{importance}**",
  section4Title: "\n### 4. Planeet van de dag",
  winnerLine: "Winnaar: **{planet}** (Importance = {importance}).\n",
  alternativeLine: "Alternatieve keuze gebruikt: {reason}.",
  section5Title: "\n### 5. Kalibratiedelta's\n",
  calibrationIntro: "Kalibratie v{version}, bron: {source}. Toegepaste mix: {blend}.\n",
  deltaLine: "- {planet}: ΔS={dS}, ΔH={dH}",
  globalTitle: "## Wiskunde globale voorspelling\n",
  globalIntro:
    "De globale voorspelling wordt zonder natalkaart opgebouwd: alleen transitposities van de zeven planeten om 12:00 UTC van de gekozen dag.",
  globalSectionPetals: "\n### Top 3 bloembladen\n",
  globalPetalLine: "- **{planet}**: gravity={gravity}, chakra {chakra}, tone={tone}",
  globalMechanicsLine:
    "Elke planeet krijgt een gravity-score: we tellen aspectbijdragen op, gecorrigeerd voor aspecttype, orb-nauwkeurigheid en het gewicht van de transitplaneet.",
  globalSectionWinner: "\n### Waarom dit het thema van de dag werd\n",
  globalWinnerLine:
    "- Hoofdthema van de dag: **{planet}** (chakra {chakra}, tone={tone}, gravity={gravity}). Deze planeet kreeg het hoogste totale gewicht binnen de transits van vandaag.",
  globalSectionRanking: "\n### Volledige rangschikking van de planeten op dit moment\n",
  globalRankingLine:
    "{rank}. **{planet}** — {sign} {degree}°, gravity={gravity}, tone={tone}",
  globalSectionAspects: "\n### Actieve aspecten van de dag\n",
  globalAspectLine: "- {from} {type} {to}, orbe={orb}°",
  globalSectionAspectWeights: "\n### Gewicht van elk aspect in het geheel\n",
  globalAspectWeightLine: "- {from} {type} {to}: orbe={orb}°, bijdrage={weight}",
});
