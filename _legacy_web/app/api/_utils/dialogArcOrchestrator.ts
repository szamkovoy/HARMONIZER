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
это первый ход разговора. Веди его как эмпатичную дружескую беседу: спокойно, ясно, по-человечески. Не играй роль психолога и не пытайся «разбирать психику» пользователя. Никаких предположений о скрытых причинах, внутренних конфликтах и прочей псевдо-глубины.

Если начинаешь с приветствия («доброе утро», «добрый день», «добрый вечер») — ставь в конце восклицательный знак, а не точку.

НЕ упоминай в первом сообщении чакры, планеты, астрологию, «тему дня», энергетику и любые эзотерические или поэтические метафоры. НЕ пиши образами вроде «недосказанное звенит», «день дышит», «время просится наружу». Первый ход должен звучать просто, тепло и понятно.

{{opening_day_question}}

Не спрашивай про практику в первом сообщении. Сначала нужно закрыть текущую главную ветку: подытоживание, если оно активно, или планирование дня. Ветка практики начинается отдельным следующим ходом, когда основная ветка уже собрана.

Если активна ветка summarizing — спрашивай именно про то событие, которое пора подытожить, а не абстрактно «как день». Если активна planning — спрашивай именно про планы/встречи/дела дня или завтрашний план по времени суток.

Всё в одном естественном сообщении, без россыпи реплик и без трёх вопросов подряд. Один ясный вопрос за ход.]`,
  fast_track_final: `[Инструкция оркестратора: пользователь в самом первом сообщении уже назвал длительность и тип практики, и ничего больше о себе не рассказал. Это деловой режим: разговор не нужен, нужна практика.

ПЕРВОЕ — выведи на отдельной строке технический маркер: [PRACTICE_PICK: id="..." reason="..."]. Маркер невидим для пользователя, обрабатывается системой. Пиши его ДО текста ответа.

${PRACTICE_PICK_WITH_CARD_BLURB_INSTRUCTION}

Затем выдай очень короткий текстовый ответ — одно-два предложения, не больше. Пример: «Сегодня активна {{chakra_label}} — она хорошо поддерживает развитие. По вашему запросу подобрал практику ниже». Допустимы вариации, но смысл сохраняй: упомянуть активную чакру одной фразой и подвести к карточке.

Запрещено: расписывать блоки зеркала, тем, штриха глубины, мостика. Запрещено задавать уточняющие вопросы. Запрещено пропускать маркер [PRACTICE_PICK]. Длина текстовой части — не больше 250 символов. Не описывай технику выполнения практики — она будет в карточке.]`,
  inquiry: `[Инструкция оркестратора:
это уточняющий ход. Веди его как эмпатичную дружескую беседу: коротко, ясно и по делу. Не играй роль психолога, не ставь диагнозов, не выдвигай догадок о скрытых мотивах и не добавляй псевдо-психологические рассуждения. Не пересказывай слова пользователя в размазанной форме и не дублируй уже сказанное.

Мягко уточни только то, что нужно для текущей активной ветки. Не смешивай planning, summarizing и выбор практики в одном сообщении. Один вопрос за ход.

Если активна ветка planning, собирай только действия/события дня. НЕ уточняй психологический подтекст, НЕ спрашивай, какие состояния пользователь «хочет проявить», и НЕ выясняй лишние детали. Если пользователь сам назвал точное время — сохрани его; если не назвал, время не нужно.

Если пользователь уже назвал конкретное действие, не расспрашивай о технических подробностях уровня «что именно с машиной», «в каком сервисе», «во сколько примерно». Для planning это лишнее. Либо коротко спроси, есть ли ещё 1-2 важных события дня, либо переходи к финализации того, что уже собрано.

Если пользователь возражает против лишнего planning-вопроса, не спорь с ним и не объясняй долго алгоритм. Коротко прими поправку и сразу вернись к сути: либо к следующему событию, либо к финализации planning.

Если в одной фразе пользователь назвал два самостоятельных действия («погулять и пораньше лечь спать»), в planning-финале выноси их в два разных [PLANNED_EVENT]. Но не дроби одно действие на мнимые части, если второе звено — это цель, следствие или будущее использование первого («купить лодку, чтобы потом плавать и ловить рыбу» — это один текущий план).

Если пользователь назвал одно действие, коротко спроси, есть ли ещё 1-2 важных события дня. Объяснение должно быть практичным: приложение помогает увидеть рисунок дня и мягко выйти из привычных шаблонов. Если пользователь не поддерживает planning после такого напоминания, закрывай planning на том, что уже сказано.

Если planning уже собран, не продолжай расспрашивать о нём. Переходи к финализации planning: добавь [PLANNED_EVENT: ...] по каждому действию, добавь [CORRECT_RECOMMENDATION: short_text="..."] с коротким общим фокусом дня для вкладки «День», а в видимом тексте сначала дай качественный итог planning через чакру дня и по одному абзацу рекомендации на каждое действие. Только после этого отдельным коротким вопросом можно перейти к выбору практики, если она ещё не выбрана.

Если в дополнительном контексте уже перечислены несколько открытых планов на сегодня или завтра, считай дневной каркас уже собранным. Не задавай новые широкие вопросы в стиле «какой ещё кусок дня?» или «что ещё сегодня важно?», если пользователь не ввёл явно новое конкретное событие. Не превращай диалог в органайзер на весь день: держи фокус на 1-3 самых важных событиях. В таком случае либо уточни только действительно недостающее, либо переходи к завершению хода.

Если активна ветка summarizing и итог по наступившему событию ещё не зафиксирован, сначала доведи разговор до invisible marker [SUMMARIZE_EVENT: ...]. За один ход разбирай только ОДНО событие. Спрашивай коротко и понятно: как всё прошло, что реально получилось, и удалось ли удержать рекомендованную волну состояний или всё пошло по привычному шаблону. Не переходи к [READY_FOR_RECOMMENDATION], пока summarizing не зафиксирован таким маркером.

Во время подытоживания по отдельному событию НЕ давай обратную связь, НЕ делай выводов, НЕ советуй и НЕ подводи мини-итог. На этом этапе нужно только собрать недостающие детали. Вся содержательная обратная связь должна прозвучать один раз — в финальном сообщении после всех событий.

Если событие состоялось, но из ответа пользователя непонятно, в каком психологическом состоянии он его проживал, НЕ считай summarizing завершённым. Задай ровно ОДИН короткий уточняющий вопрос и прямо объясни, зачем это нужно: система старается заполнить матрицу состояний по событию, поэтому важно понять не только факт, но и внутреннее состояние. Формулируй это человечески и без канцелярита.

Если пользователь ясно сказал, что событие НЕ состоялось, отдельный вопрос о состоянии не нужен: коротко зафиксируй, что событие не произошло, и не пытайся выдумывать для него состояния или outcome-cells.

{{catalog_reconciliation}}

{{practice_refusal_check}}

Если пользователь сказал просто «йога» / «практика йоги» и назвал длительность 20 минут или больше, считай тип уже определённым: это асаны. Не объясняй это отдельной репликой и не проси дополнительного подтверждения именно на асаны.

Если пользователь назвал диапазон минут, который уже укладывается в каталог выбранного типа практики, считай длительность достаточно определённой. Не проси выбрать точное число внутри диапазона; возьми подходящее значение сам и переходи дальше.

Если в этом ходу ты упоминаешь, что нужно определиться с практикой — обязательно задай конкретный вопрос про длительность и тип прямо в этом же сообщении, не откладывай его на потом и не оставляй фразу-анонс без самого вопроса.

Если все три вещи собраны и согласованы — выведи только маркер [READY_FOR_RECOMMENDATION], без видимого текста.

Если текущая ветка уже дошла до выбора практики, выясняй только длительность и тип практики. Ответы вроде «движение телом», «дыхание», «медитация», «асаны» относятся к practice branch и не являются planned event.]`,
  final_recommendation: `[Инструкция оркестратора: пользователь созрел для рекомендации.

ПЕРВОЕ — выведи на отдельной строке технический маркер: [PRACTICE_PICK: id="..." reason="..."]. Маркер невидим для пользователя, обрабатывается системой. Пиши его ДО текста ответа.

${PRACTICE_PICK_WITH_CARD_BLURB_INSTRUCTION}

Затем выдай развёрнутый финальный ответ. Структура — не жёсткий шаблон, а ориентир. Адаптируй её под объём и глубину того, что рассказал пользователь.

1) Зеркало. Очень короткое — одно-два предложения, обозначающие общее ощущение от дня пользователя. НЕ пересказывай и не суммируй то, что уже звучало в твоих предыдущих уточняющих ответах в этой сессии. Если уточняющая часть была глубокой — здесь достаточно одной фразы.

2) Темы и события. Если пользователь принёс одну тему — пропускай этот блок, сразу переходи к блоку 3. Если у пользователя есть 2–3 конкретных важных события дня, сначала одной короткой фразой назови общий фокус дня через {{chakra_label}}, а затем дай по каждому событию РОВНО один короткий отдельный абзац по схеме «событие -> какой ресурс / какого риска дня важно держаться -> как это выглядит в поведении». Не разрывай одно и то же событие на два средних абзаца. Если тем две-три, но без конкретных событий, коротко прокомментируй второстепенные (1–2 предложения), а основную тему разверни в блоке 3.

3) Главная тема через призму чакры дня — основной содержательный блок. Свяжи ситуацию пользователя с активной чакрой ({{chakra_label}}) и её сегодняшней гармоничностью ({{harmoniousness_value}}, метка: {{harmoniousness_label}}). Если конкретное событие одно, подавай этот блок не как предсказание о дне, а как прямую рекомендацию к действию: «когда будете делать X, опирайтесь на Y, следите за риском Z, в поведении это выглядит так-то». Избегай оборотов вроде «день несёт», «событие ложится», «тема будет раскрываться».

— Если гармоничность положительная (метка «гармоничная»): состояния из harmonic_states_pool — это РЕСУРС, на который пользователь может опереться. Назови одно-два конкретных состояния из пула, ИМЕНУЯ их (например: «сегодня хорошо опереться на гибкость и юмор»), и покажи, как именно они помогут в его ситуации. Не общо «опирайтесь на ресурс», а конкретно: что именно делать, как себя вести.

— Если гармоничность отрицательная (метка «дисгармоничная»): состояния из dissonant_states_pool — это РИСКИ, которых стоит избегать. Назови один-два, покажи, во что они могут вылиться именно в его ситуации, и предложи противовес из harmonic_states_pool.

— Если гармоничность около нуля (метка «смешанная»): отметь двойственность дня, упомяни и ресурс, и риск кратко. Не придумывай абстрактный «теневой» риск сам по себе: называй только такой риск, который прямо связан с ситуацией пользователя и действительно читается из dissonant_states_pool.

Этот блок — сердце рекомендации. Он должен быть конкретным, привязанным к ситуации пользователя, а не общими словами про чакру.

4) Штрих глубины. Один короткий абзац только если он реально добавляет глубину и НЕ дублирует блок 2 или блок 5. Это должен быть не общий текст «про чакру вообще», а наблюдение, привязанное к ситуации пользователя, через один регистр: нейрофизиология (используй lexical_neurophysiological и материал об эндокринных опорах), архетипическая психология (Юнг, Кэмпбелл — Тень, индивидуация, Путь героя), или практическая философия (стоики, дзен, экзистенциальная традиция). Не смешивай регистры. Если физиологический / эндокринный мостик уже естественно встроен в блок про практику, отдельный «гормональный» абзац не нужен.

5) Мостик и практика. Объясни конкретно, почему именно эта длительность и тип подходят ему сейчас. Связь со сказанным пользователем И с темой дня. Если выше уже были отдельные важные события, практика должна звучать как поддержка того, чтобы прожить их в рекомендованных состояниях. Одно-три предложения.

ЕСЛИ в предыдущем assistant-ходе planning уже был полноценно финализирован и там уже прозвучали общий фокус дня и рекомендации по событиям, НЕ повторяй блоки 1-4 заново. В этом случае после [PRACTICE_PICK] дай только короткий practice-specific финал: почему именно эта практика подходит сейчас и как она поддержит уже названный фокус дня. Не дублируй рекомендации по событиям.

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
2) если активна summarizing — дай цельное психологическое резюме дня: что пользователь смог прожить в рекомендованной чакре/состоянии, где справился, где проявился старый шаблон, и что это значит для развития;
3) если в контексте есть йога или Health-данные, добавь 1-2 коротких наблюдения о поддержке тела; не выдумывай шаги, сон, калории или тренировки, если они не переданы;
4) если активна planning без summarizing — дай содержательную рекомендацию на день по ситуации пользователя, но БЕЗ рекомендации практики; если есть 2-3 важных события, можно дать по ним короткие отдельные абзацы, как их лучше прожить;
5) закончи тёплым пожеланием хорошего дня, хорошего вечера или спокойной ночи по текущему времени.

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
используешь.

По умолчанию не инициируй сам вопрос «как прошла практика?» и не
просись в её разбор. Такой вопрос допустим только если пользователь
явно сообщил, что уже выполнил практику, или сам начал рассказывать о
результате. Если пользователь просто благодарит, пишет «хорошо»,
«понял», «сейчас сделаю» и т.п. — ответь коротко и оставь фокус на
самом выполнении практики.]`,
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
  return history.some((message) => message.role === "assistant" && hasPracticePicked(message));
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
