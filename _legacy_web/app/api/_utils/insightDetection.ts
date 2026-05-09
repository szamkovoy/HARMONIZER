const CSI_WEIGHTS = { w1: 0.4, w2: 0.3, w3: 0.3 };

const COGNITIVE_WORDS_RU = [
  "понимаю",
  "поняла",
  "понял",
  "вижу",
  "осознаю",
  "замечаю",
  "знаю",
  "значит",
  "потому что",
  "из-за того",
  "следовательно",
  "связано с",
  "причина",
  "поэтому",
  "нужно сделать",
  "оказывается",
  "как будто",
  "догадалась",
  "догадался",
  "теперь ясно",
  "думаю",
  "мне кажется",
  "получается",
  "выходит",
  "по сути",
  "значит так",
  "стало понятно",
  "пришло в голову",
  "увидел",
  "увидела",
  "получилось разглядеть",
  "ловлю себя",
  "обращаю внимание",
];

const COGNITIVE_WORDS_EN = [
  "understand",
  "see",
  "realize",
  "notice",
  "know",
  "means",
  "because",
  "due to",
  "therefore",
  "related to",
  "reason",
  "so",
  "turns out",
  "as if",
  "got it",
  "now clear",
];

const FUTURE_MARKERS_RU = [
  "буду",
  "будет",
  "будем",
  "стану",
  "станет",
  "сделаю",
  "попробую",
  "хочу попробовать",
  "планирую",
  "намерен",
  "собираюсь",
  "готов",
  "теперь",
  "с этого момента",
];

const FUTURE_MARKERS_EN = ["will", "going to", "plan to", "intend to", "ready to", "from now on", "next time"];

const PAST_MARKERS_RU = ["был", "была", "было", "сделал", "сделала", "помню", "тогда", "раньше", "когда-то", "до этого", "прежде", "в прошлом"];
const PAST_MARKERS_EN = ["was", "were", "had", "did", "remember", "back then", "before", "previously"];

const FIRST_PERSON_SINGULAR_RU = ["я", "мне", "меня", "мной", "мой", "моя", "мои", "моё"];
const FIRST_PERSON_SINGULAR_EN = ["i", "me", "my", "mine", "myself"];

const FIRST_PERSON_PLURAL_RU = ["мы", "нас", "нам", "наш", "наша", "наши", "наше"];
const FIRST_PERSON_PLURAL_EN = ["we", "us", "our", "ours", "ourselves"];

const POSITIVE_WORDS_RU = [
  "хорошо",
  "отлично",
  "класс",
  "приятно",
  "люблю",
  "радость",
  "спокойно",
  "благодарна",
  "благодарен",
  "счастлив",
  "счастлива",
  "легко",
  "интересно",
  "круто",
  "замечательно",
  "повезло",
  "получилось",
  "удалось",
];

const NEGATIVE_WORDS_RU = [
  "плохо",
  "ужасно",
  "тяжело",
  "грустно",
  "тревожно",
  "страшно",
  "злюсь",
  "бесит",
  "ненавижу",
  "устала",
  "устал",
  "выгорание",
  "бессилие",
  "одиноко",
  "обидно",
  "разочарован",
  "разочарована",
  "напряжение",
  "стресс",
  "паника",
];

const POSITIVE_WORDS_EN = ["good", "great", "nice", "love", "joy", "calm", "grateful", "happy", "easy", "interesting", "cool", "wonderful", "lucky", "managed", "succeeded"];
const NEGATIVE_WORDS_EN = ["bad", "terrible", "hard", "sad", "anxious", "scared", "angry", "annoying", "hate", "tired", "burned out", "powerless", "lonely", "hurt", "disappointed", "tension", "stress", "panic"];

export type TTMStage = "preconcept" | "concept" | "preparation" | "action" | "maintenance";

const PRECONCEPT_MARKERS_RU = ["у меня нет проблем", "это всё из-за", "не моя вина", "я в порядке", "просто такой период", "у всех так", "ничего не поделаешь", "это не я"];
const CONCEPT_MARKERS_RU = ["может быть", "когда-нибудь", "наверное стоит", "я думаю об этом", "иногда замечаю", "не уверен", "не уверена", "не знаю", "сложно сказать", "хотелось бы", "было бы хорошо"];
const PREPARATION_MARKERS_RU = [
  "я готов",
  "я готова",
  "хочу попробовать",
  "что мне сделать",
  "что мне делать",
  "как мне начать",
  "я решила",
  "я решил",
  "я хочу",
  "давай попробуем",
  "что нужно сделать",
  "пора",
  "пора что-то делать",
  "пора уже",
  "помоги с практикой",
  "к делу",
  "согласен",
  "согласна",
  "понял, действую",
  "поняла, действую",
  "приступим",
  "сейчас",
  "прямо сейчас",
];
const ACTION_MARKERS_RU = ["я уже начал", "я уже начала", "сегодня сделал", "сегодня сделала", "выполнил практику", "выполнила практику", "пробую", "практикую"];
const MAINTENANCE_MARKERS_RU = ["я делаю это уже", "уже месяц", "уже неделя", "регулярно", "каждое утро", "каждый день", "вошло в привычку", "стало частью"];

const PRECONCEPT_MARKERS_EN = ["no problems", "not my fault", "i'm fine", "just a phase", "everyone has it"];
const CONCEPT_MARKERS_EN = ["maybe", "someday", "perhaps", "i think about it", "not sure", "would be nice", "should probably"];
const PREPARATION_MARKERS_EN = ["i'm ready", "want to try", "what should i", "how do i start", "i decided", "let's try", "what needs to be done", "right now", "let's go"];
const ACTION_MARKERS_EN = ["i've started", "i did", "completed practice", "i'm trying", "practicing"];
const MAINTENANCE_MARKERS_EN = ["i've been doing this", "for a month", "for a week", "regularly", "every morning", "every day", "became a habit", "part of my"];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRussian(language: string | null | undefined): boolean {
  return (language ?? "ru").toLowerCase().startsWith("ru");
}

function countMatches(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const word of words) {
    const regex = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRegex(word)}(?=$|[^\\p{L}\\p{N}_])`, "giu");
    const matches = lower.match(regex);
    if (matches) count += matches.length;
  }
  return count;
}

function getTotalWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function computeCSI(message: string, language: string): number {
  if (!message || message.trim().length < 5) return 0;

  const ru = isRussian(language);
  const totalWords = getTotalWords(message);
  if (totalWords < 3) return 0;

  const cognitiveCount = countMatches(message, ru ? COGNITIVE_WORDS_RU : COGNITIVE_WORDS_EN);
  const futureCount = countMatches(message, ru ? FUTURE_MARKERS_RU : FUTURE_MARKERS_EN);
  const pastCount = countMatches(message, ru ? PAST_MARKERS_RU : PAST_MARKERS_EN);
  const fpsCount = countMatches(message, ru ? FIRST_PERSON_SINGULAR_RU : FIRST_PERSON_SINGULAR_EN);
  const fppCount = countMatches(message, ru ? FIRST_PERSON_PLURAL_RU : FIRST_PERSON_PLURAL_EN);

  const cognitiveRatio = cognitiveCount / totalWords;
  const tenseRatio = futureCount / (pastCount + 1);
  const personRatio = fpsCount / (fppCount + 1);

  const csi =
    CSI_WEIGHTS.w1 * Math.min(cognitiveRatio * 5, 1) +
    CSI_WEIGHTS.w2 * Math.min(tenseRatio, 1) -
    CSI_WEIGHTS.w3 * Math.min(personRatio / 5, 1);

  return Math.max(0, Math.min(1, csi));
}

export function detectInsightMoment(csiHistory: number[]): { detected: boolean; confidence: number; reason: string } {
  if (csiHistory.length < 2) return { detected: false, confidence: 0, reason: "not_enough_data" };

  const last3 = csiHistory.slice(-3);
  const recentAvg = last3.slice(-2).reduce((sum, item) => sum + item, 0) / 2;
  if (recentAvg < 0.4) return { detected: false, confidence: recentAvg, reason: "csi_too_low" };

  const last = last3[last3.length - 1];
  const prev = last3[last3.length - 2];
  const growth = last - prev;
  if (growth < 0.1) return { detected: false, confidence: recentAvg, reason: "no_growth" };

  return { detected: true, confidence: recentAvg, reason: `csi_grew_from_${prev.toFixed(2)}_to_${last.toFixed(2)}` };
}

export function estimateEmotionalValence(message: string, language: string): number {
  if (!message || message.trim().length < 3) return 0;

  const ru = isRussian(language);
  const posCount = countMatches(message, ru ? POSITIVE_WORDS_RU : POSITIVE_WORDS_EN);
  const negCount = countMatches(message, ru ? NEGATIVE_WORDS_RU : NEGATIVE_WORDS_EN);
  if (posCount === 0 && negCount === 0) return 0;

  return (posCount - negCount) / (posCount + negCount);
}

export function computeETV(valenceHistory: number[]): number {
  if (valenceHistory.length < 2) return 0;
  const mean = valenceHistory.reduce((sum, item) => sum + item, 0) / valenceHistory.length;
  const variance = valenceHistory.reduce((sum, item) => sum + (item - mean) ** 2, 0) / valenceHistory.length;
  return Math.min(1, Math.sqrt(variance));
}

export function detectTTMStage(recentMessages: string[], language: string): { stage: TTMStage; confidence: number; markers: string[] } {
  if (recentMessages.length === 0) return { stage: "concept", confidence: 0.3, markers: [] };

  const ru = isRussian(language);
  const stagesAndMarkers: Array<[TTMStage, string[]]> = [
    ["preconcept", ru ? PRECONCEPT_MARKERS_RU : PRECONCEPT_MARKERS_EN],
    ["concept", ru ? CONCEPT_MARKERS_RU : CONCEPT_MARKERS_EN],
    ["preparation", ru ? PREPARATION_MARKERS_RU : PREPARATION_MARKERS_EN],
    ["action", ru ? ACTION_MARKERS_RU : ACTION_MARKERS_EN],
    ["maintenance", ru ? MAINTENANCE_MARKERS_RU : MAINTENANCE_MARKERS_EN],
  ];

  const combinedText = recentMessages.slice(-3).join(" ");
  const counts = stagesAndMarkers.map(([stage, markers]) => {
    const matched: string[] = [];
    let count = 0;
    for (const marker of markers) {
      const regex = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRegex(marker)}(?=$|[^\\p{L}\\p{N}_])`, "giu");
      const matches = combinedText.toLowerCase().match(regex);
      if (matches) {
        count += matches.length;
        matched.push(marker);
      }
    }
    return { stage, count, matched };
  });

  counts.sort((a, b) => b.count - a.count);
  const top = counts[0];
  if (top.count === 0) return { stage: "concept", confidence: 0.2, markers: [] };

  const totalWords = getTotalWords(combinedText);
  return {
    stage: top.stage,
    confidence: Math.min(1, top.count / Math.sqrt(Math.max(totalWords, 10))),
    markers: top.matched,
  };
}

export function isReadyForPractice(ttmStage: TTMStage): { ready: boolean; reason: string } {
  switch (ttmStage) {
    case "preconcept":
      return { ready: false, reason: "preconcept_resistance" };
    case "concept":
      return { ready: false, reason: "concept_ambivalence" };
    case "preparation":
      return { ready: true, reason: "preparation_signals" };
    case "action":
      return { ready: true, reason: "already_in_action" };
    case "maintenance":
      return { ready: true, reason: "maintenance_phase" };
  }
}
