import { getDomainPrompt, normalizeWhisperLanguage } from "./whisperPrompts";

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
};

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

export async function transcribeGroqAudio(body: TranscribeAudioBody): Promise<TranscribeAudioResponse> {
  const base64 = body.audio?.base64;
  const mimeType = body.audio?.mimeType ?? "audio/m4a";
  if (!base64) throw new Response(JSON.stringify({ error: "audio.base64 is required" }), { status: 400 });

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing GROQ_API_KEY");

  const language = normalizeWhisperLanguage(body.language);
  const bytes = Buffer.from(base64, "base64");
  const file = new Blob([bytes], { type: mimeType });
  const form = new FormData();
  form.append("file", file, `audio.${extensionFor(mimeType)}`);
  form.append("model", "whisper-large-v3");
  form.append("language", language);
  form.append("prompt", getDomainPrompt(language));
  form.append("temperature", "0");
  form.append("response_format", "verbose_json");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Groq transcription failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const data = (await res.json()) as {
    text?: string;
    language?: string;
    duration?: number;
    segments?: Array<{ avg_logprob?: number }>;
  };

  return {
    text: data.text ?? "",
    language: normalizeWhisperLanguage(data.language ?? language),
    durationSeconds: data.duration,
    confidence: confidenceFromSegments(data.segments),
  };
}
