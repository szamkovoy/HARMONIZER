import { errorResponse, json, requireUserId } from "../../../_utils/supabase";

export const runtime = "nodejs";

type Body = {
  audio?: {
    mimeType?: string;
    base64?: string;
  };
  language?: string;
};

function extensionFor(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  return "m4a";
}

function confidenceFromSegments(segments: Array<{ avg_logprob?: number }> | undefined): number | undefined {
  if (!segments?.length) return undefined;
  const total = segments.reduce((sum, segment) => sum + Math.exp(Number(segment.avg_logprob ?? -1)), 0);
  return total / segments.length;
}

export async function POST(req: Request) {
  try {
    await requireUserId(req);
    const body = (await req.json()) as Body;
    const base64 = body.audio?.base64;
    const mimeType = body.audio?.mimeType ?? "audio/m4a";
    if (!base64) return json({ error: "audio.base64 is required" }, { status: 400 });

    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) throw new Error("Missing GROQ_API_KEY");

    const bytes = Buffer.from(base64, "base64");
    const file = new Blob([bytes], { type: mimeType });
    const form = new FormData();
    form.append("file", file, `audio.${extensionFor(mimeType)}`);
    form.append("model", "whisper-large-v3");
    form.append("language", body.language ?? "ru");
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
    return json({
      text: data.text ?? "",
      language: data.language ?? body.language ?? "ru",
      durationSeconds: data.duration,
      confidence: confidenceFromSegments(data.segments),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
