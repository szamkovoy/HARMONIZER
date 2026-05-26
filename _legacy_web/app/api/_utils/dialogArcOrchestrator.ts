import { buildCatalogReconciliationInstruction, userAnsweredPracticeRequest, userDeclinedPracticeInHistory, validateHistoryHasDurationAndType } from "@legacy/app/api/_utils/markers";
import { getPracticeRefusalThreshold } from "@legacy/app/api/_utils/dialogConfig";

type Message = {
  role: "user" | "assistant" | "system";
  meta?: Record<string, unknown> | null;
  content?: string | null;
  transcript?: string | null;
};

const PRACTICE_PICK_WITH_CARD_BLURB_INSTRUCTION = `В маркер [PRACTICE_PICK] обязательно добавь поле card_blurb — короткий текст для карточки практики под сообщением. Формат:

[PRACTICE_PICK: id="..." reason="..." card_blurb="..."]

Требования к card_blurb:
— Состоит из 2 предложений для асан и 3 предложений для дыхания и медитации, слитых в один связный текст без списка и без переносов строк.
— Первое предложение: одна точная мысль о сути этой конкретной практики и чем она особенна. Опирайся на её название и тип; если в каталоге есть описание, бери из него смысл, но не копируй дословно.
— Второе предложение: о том, на каких состояниях удерживать внимание во время практики. Выбери 2-4 состояния только из harmonic_states_pool и по возможности свяжи их с тем, что волнует пользователя.
— Третье предложение — ТОЛЬКО для дыхания и медитации, для асан НЕ выводить: «Если вы владеете пранаямой, дышите через {{chakra_label_accusative}}». Используй переменную дословно, не склоняй сам.
— Весь card_blurb — 250-500 символов. Не используй двойные кавычки внутри значения; если нужны кавычки, возьми «ёлочки» или одинарные.`;

export const ORCHESTRATOR_INSTRUCTIONS = {
  opening: `[Инструкция оркестратора:
это первый ход разговора. Поздоровайся естественно, с учётом времени суток. Начни по-человечески и ясно, как хороший живой собеседник.

НЕ упоминай в первом сообщении чакры, планеты, астрологию, «тему дня», «горло дня», энергетику и любые эзотерические или поэтические метафоры. НЕ пиши образами вроде «недосказанное звенит», «день дышит», «время просится наружу». Первый ход должен звучать просто, тепло и понятно.

{{opening_day_question}}

В этом же сообщении задай прямой вопрос про практику. Формулировка должна быть конкретной и понятной, без поэтических метафор. Хороший пример: «Сколько у вас сейчас времени на практику и что бы хотелось — асаны, дыхание или медитацию?». Допустимы варианты: «Сколько минут есть для практики и какой тип ближе — асаны, дыхание, медитация?». Недопустимо: «окно на короткую паузу или сессия?», «короткий выдох или полная сессия?», «пять минут присесть или развернуться?» — это слишком метафорично для первого вопроса.

Если активна ветка summarizing — спрашивай именно про то событие, которое пора подытожить, а не абстрактно «как день». Если активна planning — спрашивай именно про планы/встречи/дела дня или завтрашний план по времени суток.

Всё в одном естественном сообщении, не в трёх вопросах подряд. Один лёгкий открытый вопрос про жизнь + один конкретный про практику.]`,
  fast_track_final: `[Инструкция оркестратора: пользователь в самом первом сообщении уже назвал длительность и тип практики, и ничего больше о себе не рассказал. Это деловой режим: разговор не нужен, нужна практика.

ПЕРВОЕ — выведи на отдельной строке технический маркер: [PRACTICE_PICK: id="..." reason="..."]. Маркер невидим для пользователя, обрабатывается системой. Пиши его ДО текста ответа.

${PRACTICE_PICK_WITH_CARD_BLURB_INSTRUCTION}

Затем выдай очень короткий текстовый ответ — одно-два предложения, не больше. Пример: «Сегодня активна {{chakra_label}} — она хорошо поддерживает развитие. По вашему запросу подобрал практику ниже». Допустимы вариации, но смысл сохраняй: упомянуть активную чакру одной фразой и подвести к карточке.

Запрещено: расписывать блоки зеркала, тем, штриха глубины, мостика. Запрещено задавать уточняющие вопросы. Запрещено пропускать маркер [PRACTICE_PICK]. Длина текстовой части — не больше 250 символов. Не описывай технику выполнения практики — она будет в карточке.]`,
  inquiry: `[Инструкция оркестратора:
это уточняющий ход. Слушай пользователя, иди за его языком. Если он что-то сказал о себе — поддержи коротко и иди вглубь, а не отзеркаливай поверхностно. Один-два штриха: что услышал, что в этом важно. Не пересказывай его же слова другими словами — это создаёт ощущение пустоты.

Мягко уточни то, чего ещё не хватает из трёх вещей (КОНТЕКСТ, ДЛИТЕЛЬНОСТЬ, ТИП). Один вопрос за ход. Если повторяешь вопрос про длительность или тип — переформулируй принципиально иначе, не дословно.

Если активна ветка planning и ещё не выделено конкретное ближайшее событие, сначала помоги собрать один предметный эпизод на сегодня или завтра и доведи его до invisible marker [PLANNED_EVENT: ...]. Не переходи к [READY_FOR_RECOMMENDATION], пока planning не зафиксирован таким маркером.

Если пользователь уже назвал конкретное дело или встречу с явным либо примерным временем, считай planning по этому эпизоду собранным. На этапе planning НЕ уточняй сферу жизни, подтекст события, внутреннее состояние, «что в этом важнее» и другие классифицирующие детали — они нужны для summarizing, а не для первичного планирования.

Если в дополнительном контексте уже перечислены несколько открытых планов на сегодня или завтра, считай дневной каркас уже собранным. Не задавай новые широкие вопросы в стиле «какой ещё кусок дня?» или «что ещё сегодня важно?», если пользователь не ввёл явно новое конкретное событие. В таком случае либо уточни только действительно недостающее, либо переходи к завершению хода.

Если активна ветка summarizing и итог по наступившему событию ещё не зафиксирован, сначала доведи разговор до invisible marker [SUMMARIZE_EVENT: ...]. Не переходи к [READY_FOR_RECOMMENDATION], пока summarizing не зафиксирован таким маркером.

{{catalog_reconciliation}}

{{practice_refusal_check}}

Если пользователь сказал просто «йога» / «практика йоги» и назвал длительность 20 минут или больше, считай тип уже определённым: это асаны. Не объясняй это отдельной репликой и не проси дополнительного подтверждения именно на асаны.

Если пользователь назвал диапазон минут, который уже укладывается в каталог выбранного типа практики, считай длительность достаточно определённой. Не проси выбрать точное число внутри диапазона; возьми подходящее значение сам и переходи дальше.

Если в этом ходу ты упоминаешь, что нужно определиться с практикой — обязательно задай конкретный вопрос про длительность и тип прямо в этом же сообщении, не откладывай его на потом и не оставляй фразу-анонс без самого вопроса.

Если все три вещи собраны и согласованы — выведи только маркер [READY_FOR_RECOMMENDATION], без видимого текста.

Если пользователь явно просит практику без разговора — сразу выясняй длительность и тип, не настаивай на разговоре.]`,
  final_recommendation: `[Инструкция оркестратора: пользователь созрел для рекомендации.

ПЕРВОЕ — выведи на отдельной строке технический маркер: [PRACTICE_PICK: id="..." reason="..."]. Маркер невидим для пользователя, обрабатывается системой. Пиши его ДО текста ответа.

${PRACTICE_PICK_WITH_CARD_BLURB_INSTRUCTION}

Затем выдай развёрнутый финальный ответ. Структура — не жёсткий шаблон, а ориентир. Адаптируй её под объём и глубину того, что рассказал пользователь.

1) Зеркало. Очень короткое — одно-два предложения, обозначающие общее ощущение от дня пользователя. НЕ пересказывай и не суммируй то, что уже звучало в твоих предыдущих уточняющих ответах в этой сессии. Если уточняющая часть была глубокой — здесь достаточно одной фразы.

2) Темы. Если пользователь принёс одну тему — пропускай этот блок, сразу переходи к блоку 3. Если две-три темы — короткие комментарии по каждой второстепенной (1–2 предложения), основная тема разворачивается в блоке 3.

3) Главная тема через призму чакры дня — основной содержательный блок. Свяжи ситуацию пользователя с активной чакрой ({{chakra_label}}) и её сегодняшней гармоничностью ({{harmoniousness_value}}, метка: {{harmoniousness_label}}).

— Если гармоничность положительная (метка «гармоничная»): состояния из harmonic_states_pool — это РЕСУРС, на который пользователь может опереться. Назови одно-два конкретных состояния из пула, ИМЕНУЯ их (например: «сегодня хорошо опереться на гибкость и юмор»), и покажи, как именно они помогут в его ситуации. Не общо «опирайтесь на ресурс», а конкретно: что именно делать, как себя вести.

— Если гармоничность отрицательная (метка «дисгармоничная»): состояния из dissonant_states_pool — это РИСКИ, которых стоит избегать. Назови один-два, покажи, во что они могут вылиться именно в его ситуации, и предложи противовес из harmonic_states_pool.

— Если гармоничность около нуля (метка «смешанная»): отметь двойственность дня, упомяни и ресурс, и риск кратко.

Этот блок — сердце рекомендации. Он должен быть конкретным, привязанным к ситуации пользователя, а не общими словами про чакру.

4) Штрих глубины. Один-два абзаца НЕ ВООБЩЕ про чакру, а ПРИВЯЗАННЫЕ к ситуации пользователя через регистр: нейрофизиология (используй lexical_neurophysiological и материал об эндокринных опорах), архетипическая психология (Юнг, Кэмпбелл — Тень, индивидуация, Путь героя), или практическая философия (стоики, дзен, экзистенциальная традиция). Регистр выбирай по теме: конфликт и тень — Юнг; усталость, сон, истощение — нейрофизиология; выбор пути, кризис смысла — философия или Кэмпбелл. Не смешивай регистры в одном штрихе. Не цитируй авторов — формулируй своё наблюдение на их языке. Если у пользователя нет глубокой темы (только «дай практику»), штрих делай коротким и обобщённым по чакре.

5) Мостик и практика. Объясни конкретно, почему именно эта длительность и тип подходят ему сейчас. Связь со сказанным пользователем И с темой дня. Одно-три предложения.

ОБЩИЕ ПРАВИЛА:

Длина ответа определяется глубиной разговора. Если пользователь рассказал много и глубоко — финал развёрнутый, 1500–2500 символов. Если рассказал мало или поверхностно — финал короче, 600–1200 символов. Не растягивай ответ ради объёма. Не повторяй то, что уже сказал в уточняющих ходах.

Запрещено: пропускать маркер [PRACTICE_PICK], пропускать блок 3 (главная тема через призму чакры) и блок 5 (мостик и практика). Блоки 1, 2, 4 могут сжиматься или опускаться по логике разговора. Не описывай технику выполнения практики — она будет в карточке. Не задавай в финальном сообщении никаких вопросов и не проси пользователя что-либо уточнить после рекомендации: карточка уже выбрана, текст должен завершать ход, а не открывать новый.]`,
  final_recommendation_with_validation_warning: `[Инструкция оркестратора: standard-модель сигнализировала готовность, но автоматический валидатор не нашёл явных признаков длительности или типа в истории.

Если ты можешь дать рекомендацию с разумным дефолтом (когерентное дыхание 10 минут на активную чакру дня) — давай. Если нет (длительность или тип критичны для рекомендации) — мягко уточни недостающее прямо в тексте, НЕ выдавая маркер [PRACTICE_PICK].

В случае выдачи рекомендации:
ПЕРВОЕ — выведи на отдельной строке маркер: [PRACTICE_PICK: id="default" reason="..."]. Маркер невидим для пользователя.

${PRACTICE_PICK_WITH_CARD_BLURB_INSTRUCTION}

Затем следуй структуре и правилам из \`final_recommendation\` (блоки 1–5, привязка к чакре и её гармоничности, штрих глубины привязан к ситуации, длина по глубине разговора, обязательны блоки 3 и 5). Финальный текст не должен содержать вопросов или просьб что-то дополнительно уточнить.]`,
  forced_final: `[Инструкция оркестратора: диалог дошёл до максимума ходов. Дай финальную рекомендацию прямо сейчас на основе того, что уже собрано. Информация может быть неполной — используй разумные дефолты (когерентное дыхание 10 минут на чакру дня), если данных не хватает.

ПЕРВОЕ — выведи на отдельной строке маркер: [PRACTICE_PICK: id="default" reason="..."]. Маркер невидим для пользователя.

${PRACTICE_PICK_WITH_CARD_BLURB_INSTRUCTION}

Затем следуй структуре из \`final_recommendation\` (блоки 1–5). Если контекста почти нет — блоки 1 и 2 пропусти, переходи сразу к блоку 3 (главная тема через призму чакры) и блоку 5 (мостик к практике). Не выдумывай за пользователя то, чего он не сказал. Не описывай технику выполнения практики — она будет в карточке. Финальный текст не должен содержать вопросов или просьб что-то дополнительно уточнить.]`,
  final_without_practice: `[Инструкция оркестратора:
это финальный ход диалога без карточки практики. Диалог завершается здесь, просто в этом финале практика не предлагается.

Не спрашивай про длительность, тип или «может другой формат». Не выводи [PRACTICE_PICK] и [READY_FOR_RECOMMENDATION]. Не уточняй «совсем или не сейчас» — решение уже принято.

Если активна ветка summarizing и пользователь уже описал, как прошло наступившее событие, сначала добавь invisible marker [SUMMARIZE_EVENT: ...], а потом уже дай видимый ответ. Это нужно сделать без рекомендации практики.

Дай ОДИН финальный ответ без дальнейших вопросов. В этом ответе:
1) коротко поддержи то, что пользователь сказал о дне;
2) если активна planning или summarizing — дай содержательную рекомендацию на день по ситуации пользователя, но БЕЗ рекомендации практики;
3) закончи тёплым пожеланием хорошего дня, хорошего вечера или спокойной ночи по текущему времени.

Ответ должен естественно завершать разговор. Не оставляй открытых вопросов и не приглашай продолжать обсуждение прямо сейчас.]`,
  practice_repick: `[Инструкция оркестратора: практика уже была предложена, и пользователь попросил другой вариант.

ПЕРВОЕ — выведи на отдельной строке технический маркер: [PRACTICE_PICK: id="..." reason="..."]. Маркер невидим для пользователя, обрабатывается системой. Пиши его ДО текста ответа.

${PRACTICE_PICK_WITH_CARD_BLURB_INSTRUCTION}

Затем дай очень короткий ответ — одно-два предложения, не больше 240 символов. Спокойно подтверди, что предлагаешь другой вариант, и подведи к новой карточке ниже.

Не повторяй длинную финальную рекомендацию заново. Не пересказывай весь день. Не задавай вопросов. Не обсуждай старую практику подробно.]`,
  post_recommendation: `[Инструкция
оркестратора: практика уже выбрана в предыдущем ходу. Веди
себя кратко по правилам из системного промпта (раздел «если
практика уже выбрана»). Маркер [READY_FOR_RECOMMENDATION] не
используешь.]`,
} as const;

export function shouldServerEscalateToFinalRecommendation(params: {
  turnMode: OrchestratorMode;
  validation: { confident: boolean };
  hasReadyMarker: boolean;
  hasRequiredBranchArtifacts: boolean;
}): boolean {
  return !params.hasReadyMarker
    && params.validation.confident
    && params.turnMode === "inquiry"
    && params.hasRequiredBranchArtifacts;
}

export interface ArcDecision {
  mode: "opening" | "inquiry" | "forced_final" | "fast_track_final" | "final_without_practice" | "post_recommendation" | "practice_repick";
  modelTier: "premium" | "standard";
  instruction: string;
  instructionVariables?: {
    practice_refusal_check?: string;
    catalog_reconciliation?: string;
  };
}

export type OrchestratorMode = ArcDecision["mode"];

const PRACTICE_REFUSAL_CHECK_INSTRUCTION = `ВАЖНО ДЛЯ ЭТОГО ХОДА: пользователь уже не ответил на вопрос о длительности и типе практики (но явного отказа от практики ещё не было). В этом ходу не повторяй обычный уточняющий вопрос. Вместо этого прямо спроси, нужна ли практика вообще: «Возможно, сейчас вам не до практики — нет времени или просто не хочется? Если нужна — скажите длительность и тип. Если нет — так и скажите, я не буду настаивать». Адаптируй формулировку под обращение, смысл сохрани.`;

function hasPracticePicked(message: Message): boolean {
  const practicePicked = (message.meta as { practicePicked?: unknown; practice_picked?: unknown } | null)?.practicePicked
    ?? (message.meta as { practice_picked?: unknown } | null)?.practice_picked;
  return practicePicked != null;
}

function lastAssistantOfferedPracticeInHistory(history: Message[]): boolean {
  const lastAssistant = [...history].reverse().find((message) => message.role === "assistant");
  return Boolean(lastAssistant && hasPracticePicked(lastAssistant));
}

function userRejectsPracticeOfferText(text: string): boolean {
  return /(друг|инач|не\s+хочу|не\s+подходит|не\s+то|замен|альтернатив|another|different|not\s+this)/i.test(text);
}

function textFromMessage(message: Message): string {
  return String(message.content ?? message.transcript ?? "").trim();
}

function turnModeFromMessageMeta(message: Message): OrchestratorMode | null {
  const meta = message.meta as { turn_mode?: unknown; turnMode?: unknown } | null | undefined;
  const raw = meta?.turn_mode ?? meta?.turnMode;
  return raw === "opening"
    || raw === "inquiry"
    || raw === "forced_final"
    || raw === "fast_track_final"
    || raw === "final_without_practice"
    || raw === "post_recommendation"
    || raw === "practice_repick"
    || raw === "practice_declined"
    ? (raw === "practice_declined" ? "final_without_practice" : raw)
    : null;
}

/** Текст единственного «первого» сообщения пользователя для fast_track, включая ответ после автоприветствия. */
function soleFirstUserMessageText(history: Message[], pendingUserContent: string | null | undefined): string {
  const users = history.filter((m) => m.role === "user");
  const assistants = history.filter((m) => m.role === "assistant");
  const pendingTrim = typeof pendingUserContent === "string" ? pendingUserContent.trim() : "";

  // Прямой первый запрос пользователя без initiate либо первый ответ пользователя после opening.
  if (pendingTrim && users.length === 0 && assistants.length <= 1) {
    return pendingTrim;
  }

  // Редкий путь: первая реплика уже в истории, но ответа ассистента ещё не было.
  if (!pendingTrim && users.length === 1 && assistants.length === 0) {
    return textFromMessage(users[0]!);
  }
  return "";
}

const PRACTICE_ONLY_FILLER_PHRASES = [
  "в течение",
  "прямо сейчас",
  "на сейчас",
  "у меня",
  "пожалуйста",
  "наверное",
  "наверно",
  "примерно",
  "пол часа",
  "четверть часа",
  "пару минут",
  "практику",
  "практика",
  "дыхательную практику",
  "дыхательную",
  "медитация",
  "медитацию",
  "медитации",
  "дыхание",
  "асаны",
  "асану",
  "йога",
  "йогу",
  "йоги",
  "минута",
  "минуты",
  "минуту",
  "минут",
  "мин",
  "часов",
  "часа",
  "час",
  "полчаса",
  "я",
  "мне",
  "мой",
  "мою",
  "моя",
  "моё",
  "мы",
  "нам",
  "наш",
  "нашу",
  "хочу",
  "хотел",
  "хотела",
  "хотелось",
  "предпочел",
  "предпочла",
  "предпочёл",
  "прошу",
  "нужна",
  "нужно",
  "нужен",
  "подберите",
  "подбери",
  "предложи",
  "посоветуй",
  "сделать",
  "выполнить",
  "взять",
  "выбрать",
  "подобрать",
  "просто",
  "около",
  "гдето",
  "где то",
  "и",
  "а",
  "но",
  "ну",
  "же",
  "вот",
  "бы",
];

function residualNonPracticeText(text: string): string {
  let cleaned = text
    .toLowerCase()
    .replace(/[0-9]+/g, " ")
    .replace(/[.,!?;:()[\]{}"'`«»/\\-]+/g, " ");

  for (const phrase of PRACTICE_ONLY_FILLER_PHRASES) {
    cleaned = cleaned.replaceAll(phrase, " ");
  }

  return cleaned
    .replace(/\s+/g, " ")
    .trim();
}

function isPracticeOnlyFirstTurn(
  text: string,
  validation: ReturnType<typeof validateHistoryHasDurationAndType>,
): boolean {
  if (!validation.confident) return false;

  const residual = residualNonPracticeText(text);
  if (!residual) return true;

  // Short leftovers like "сейчас" or "для меня" are harmless; longer residue means user brought real life context.
  const residualWords = residual.split(/\s+/).filter(Boolean);
  const residualChars = residual.replace(/\s+/g, "").length;
  return residualWords.length <= 3 && residualChars <= 18;
}

function userTextsFromHistory(history: Message[], pendingUserContent?: string | null): string[] {
  const pendingTrim = typeof pendingUserContent === "string" ? pendingUserContent.trim() : "";
  return [
    ...history
      .filter((message) => message.role === "user")
      .map((message) => textFromMessage(message)),
    ...(pendingTrim ? [pendingTrim] : []),
  ];
}

function countConsecutiveUnresolvedPracticePrompts(
  history: Message[],
  pendingUserContent: string | null | undefined,
): number {
  if (userDeclinedPracticeInHistory(userTextsFromHistory(history, pendingUserContent))) return 0;

  const pendingTrim = typeof pendingUserContent === "string" ? pendingUserContent.trim() : "";
  const validation = validateHistoryHasDurationAndType([
    ...history
      .filter((message) => message.role === "user")
      .map((message) => ({ role: "user" as const, content: textFromMessage(message) })),
    ...(pendingTrim ? [{ role: "user" as const, content: pendingTrim }] : []),
  ]);
  if (validation.confident || userAnsweredPracticeRequest(validation)) return 0;

  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role !== "assistant") continue;
    const turnMode = turnModeFromMessageMeta(message);
    if (turnMode === "opening" || turnMode === "inquiry") {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

export function decideTurnMode(
  history: Message[],
  iteration: number,
  maxDialogLength: number,
  pendingUserContent?: string | null,
  emitFastTrackDiagnostics = false,
): ArcDecision {
  if (history.some((message) => message.role === "assistant" && hasPracticePicked(message))) {
    const pendingTrim = typeof pendingUserContent === "string" ? pendingUserContent.trim() : "";
    if (pendingTrim && lastAssistantOfferedPracticeInHistory(history) && userRejectsPracticeOfferText(pendingTrim)) {
      return {
        mode: "practice_repick",
        modelTier: "premium",
        instruction: ORCHESTRATOR_INSTRUCTIONS.practice_repick,
      };
    }
    return {
      mode: "post_recommendation",
      modelTier: "standard",
      instruction: ORCHESTRATOR_INSTRUCTIONS.post_recommendation,
    };
  }

  if (iteration >= maxDialogLength) {
    return {
      mode: "forced_final",
      modelTier: "premium",
      instruction: ORCHESTRATOR_INSTRUCTIONS.forced_final,
    };
  }

  if (userDeclinedPracticeInHistory(userTextsFromHistory(history, pendingUserContent))) {
    return {
      mode: "final_without_practice",
      modelTier: "standard",
      instruction: ORCHESTRATOR_INSTRUCTIONS.final_without_practice,
    };
  }

  const userText = soleFirstUserMessageText(history, pendingUserContent);
  if (userText) {
    const fastTrackValidation = validateHistoryHasDurationAndType([{ role: "user", content: userText }]);
    const practiceOnlyFirstTurn = isPracticeOnlyFirstTurn(userText, fastTrackValidation);
    const chosenMode = practiceOnlyFirstTurn ? "fast_track_final" : iteration === 1 ? "opening" : "inquiry";
    if (emitFastTrackDiagnostics) {
      console.log(`[FAST_TRACK_DIAG] ${JSON.stringify({
        firstUserMessageText: userText,
        confident: fastTrackValidation.confident,
        hasDuration: fastTrackValidation.hasDuration,
        hasType: fastTrackValidation.hasType,
        practiceOnlyFirstTurn,
        chosenMode,
      })}`);
    }
    if (practiceOnlyFirstTurn) {
      return {
        mode: "fast_track_final",
        modelTier: "premium",
        instruction: ORCHESTRATOR_INSTRUCTIONS.fast_track_final,
      };
    }
  }

  if (iteration === 1) {
    return {
      mode: "opening",
      modelTier: "standard",
      instruction: ORCHESTRATOR_INSTRUCTIONS.opening,
    };
  }

  const unresolvedPracticePromptCount = countConsecutiveUnresolvedPracticePrompts(history, pendingUserContent);
  const pendingValidation = validateHistoryHasDurationAndType([
    ...history
      .filter((message) => message.role === "user")
      .map((message) => ({ role: "user" as const, content: textFromMessage(message) })),
    ...(typeof pendingUserContent === "string" && pendingUserContent.trim()
      ? [{ role: "user" as const, content: pendingUserContent.trim() }]
      : []),
  ]);

  return {
    mode: "inquiry",
    modelTier: "standard",
    instruction: ORCHESTRATOR_INSTRUCTIONS.inquiry,
    instructionVariables: {
      catalog_reconciliation: buildCatalogReconciliationInstruction(pendingValidation),
      practice_refusal_check:
        !userAnsweredPracticeRequest(pendingValidation)
        && unresolvedPracticePromptCount >= getPracticeRefusalThreshold()
          ? PRACTICE_REFUSAL_CHECK_INSTRUCTION
          : "",
    },
  };
}
