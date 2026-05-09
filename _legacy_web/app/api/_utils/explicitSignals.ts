import dialogSignalsJson from "@/data/dialog_signals.json";

export type ExplicitSignal =
  | "request_practice"
  | "request_close"
  | "request_topic_shift"
  | "request_concrete"
  | "disagreement";

export interface ExplicitSignalsResult {
  signals: ExplicitSignal[];
  matched: Record<ExplicitSignal, string[]>;
}

type LangPhrases = Record<"ru" | "en", string[]>;

type DialogSignalsByCategory = Record<ExplicitSignal, LangPhrases>;

const dialogSignals = dialogSignalsJson as DialogSignalsByCategory & {
  schema_version?: number;
};

export function detectExplicitSignals(
  message: string,
  language: string,
): ExplicitSignalsResult {
  const lang = language.startsWith("ru") ? "ru" : "en";
  const lower = message.toLowerCase();

  const signals: ExplicitSignal[] = [];
  const matched: Record<ExplicitSignal, string[]> = {
    request_practice: [],
    request_close: [],
    request_topic_shift: [],
    request_concrete: [],
    disagreement: [],
  };

  const categories: ExplicitSignal[] = [
    "request_practice",
    "request_close",
    "request_topic_shift",
    "request_concrete",
    "disagreement",
  ];

  for (const cat of categories) {
    const phrases = dialogSignals[cat][lang];
    for (const phrase of phrases) {
      if (lower.includes(phrase)) {
        if (!signals.includes(cat)) signals.push(cat);
        matched[cat].push(phrase);
      }
    }
  }

  return { signals, matched };
}
