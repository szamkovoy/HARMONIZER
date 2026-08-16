import { getDomainPrompt, normalizeWhisperLanguage } from "./whisperPrompts";
import {
  getWhisperCircuitState,
  isGroqBlocked,
  markGroqFailover,
  markGroqSuccess,
} from "./whisperCircuitBreaker";
import { isGroqFailoverStatus } from "./whisperWaitTime";

export type TranscribeAudioBody = {
  audio?: {
    mimeType?: string;
    base64?: string;
  };
  language?: string;
};

export type TranscribeAudioResponse = {
  text: string;
  language: string;
  durationSeconds?: number;
  confidence?: number;
  /** Which STT backend served this request (observability). */
  provider?: "groq" | "openai";
};

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3";
const OPENAI_MODEL = "whisper-1";

function extensionFor(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("3gpp")) return "3gp";
  return "m4a";
}

export function confidenceFromSegments(segments: Array<{ avg_logprob?: number }> | undefined): number | undefined {
  if (!segments?.length) return undefined;
  const total = segments.reduce((sum, segment) => sum + Math.exp(Number(segment.avg_logprob ?? -1)), 0);
  return total / segments.length;
}

function buildWhisperForm(body: TranscribeAudioBody, model: string): {
  form: FormData;
  language: string | undefined;
} {
  const base64 = body.audio?.base64;
  const mimeType = body.audio?.mimeType ?? "audio/m4a";
  if (!base64) throw new Response(JSON.stringify({ error: "audio.base64 is required" }), { status: 400 });

  const language = normalizeWhisperLanguage(body.language);
  const bytes = Buffer.from(base64, "base64");
  const file = new Blob([bytes], { type: mimeType });
  const form = new FormData();
  form.append("file", file, `audio.${extensionFor(mimeType)}`);
  form.append("model", model);
  if (language) form.append("language", language);
  form.append("prompt", getDomainPrompt(language));
  form.append("temperature", "0");
  form.append("response_format", "verbose_json");
  return { form, language };
}

function parseWhisperJson(
  data: {
    text?: string;
    language?: string;
    duration?: number;
    segments?: Array<{ avg_logprob?: number }>;
  },
  languageHint: string | undefined,
  provider: "groq" | "openai",
): TranscribeAudioResponse {
  return {
    text: data.text ?? "",
    language: normalizeWhisperLanguage(data.language ?? languageHint) ?? "ru",
    durationSeconds: data.duration,
    confidence: confidenceFromSegments(data.segments),
    provider,
  };
}

class WhisperHttpError extends Error {
  readonly status: number;
  readonly headers: Headers;
  readonly bodyText: string;

  constructor(provider: string, status: number, headers: Headers, bodyText: string) {
    super(`${provider} transcription failed: ${status} ${bodyText.slice(0, 300)}`);
    this.name = "WhisperHttpError";
    this.status = status;
    this.headers = headers;
    this.bodyText = bodyText;
  }
}

async function postWhisper(
  url: string,
  apiKey: string,
  form: FormData,
  providerLabel: string,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  }).catch((error) => {
    const msg = error instanceof Error ? error.message : String(error);
    throw new WhisperHttpError(providerLabel, 503, new Headers(), msg);
  });
}

async function transcribeOpenAiAudio(body: TranscribeAudioBody): Promise<TranscribeAudioResponse> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY (required for Whisper fallback)");

  const { form, language } = buildWhisperForm(body, OPENAI_MODEL);
  const res = await postWhisper(OPENAI_URL, apiKey, form, "OpenAI");
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new WhisperHttpError("OpenAI", res.status, res.headers, text);
  }
  const data = JSON.parse(text) as {
    text?: string;
    language?: string;
    duration?: number;
    segments?: Array<{ avg_logprob?: number }>;
  };
  return parseWhisperJson(data, language, "openai");
}

async function transcribeGroqOnce(body: TranscribeAudioBody): Promise<TranscribeAudioResponse> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing GROQ_API_KEY");

  const { form, language } = buildWhisperForm(body, GROQ_MODEL);
  const res = await postWhisper(GROQ_URL, apiKey, form, "Groq");
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new WhisperHttpError("Groq", res.status, res.headers, text);
  }
  const data = JSON.parse(text) as {
    text?: string;
    language?: string;
    duration?: number;
    segments?: Array<{ avg_logprob?: number }>;
  };
  return parseWhisperJson(data, language, "groq");
}

/**
 * Primary STT entry: Groq Whisper with automatic OpenAI Whisper fallback when
 * Groq is rate-limited / unavailable (circuit breaker).
 */
export async function transcribeWhisperAudio(body: TranscribeAudioBody): Promise<TranscribeAudioResponse> {
  const state = await getWhisperCircuitState();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  if (isGroqBlocked(state) && openaiKey) {
    console.warn(
      `[STT Circuit] Groq blocked until ${new Date(state.groqBlockedUntil).toISOString()}; using OpenAI`,
    );
    return transcribeOpenAiAudio(body);
  }

  try {
    const result = await transcribeGroqOnce(body);
    if (state.groqBlockedUntil > 0 || state.consecutiveFallbackCount > 0) {
      await markGroqSuccess();
    }
    return result;
  } catch (error) {
    if (!(error instanceof WhisperHttpError) || !isGroqFailoverStatus(error.status)) {
      throw error;
    }

    await markGroqFailover({
      status: error.status,
      headers: error.headers,
      bodyText: error.bodyText,
    });

    if (!openaiKey) {
      throw new Error(
        `Groq Whisper unavailable (HTTP ${error.status}) and OPENAI_API_KEY is not configured`,
      );
    }

    return transcribeOpenAiAudio(body);
  }
}

/** @deprecated Prefer `transcribeWhisperAudio` — kept for call-site compatibility. */
export async function transcribeGroqAudio(body: TranscribeAudioBody): Promise<TranscribeAudioResponse> {
  return transcribeWhisperAudio(body);
}
