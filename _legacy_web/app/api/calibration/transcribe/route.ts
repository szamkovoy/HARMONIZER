import { errorResponse, json, requireUserId } from "../../_utils/supabase";
import { transcribeGroqAudio, type TranscribeAudioBody } from "../../_utils/whisperTranscription";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await requireUserId(req);
    const body = (await req.json()) as TranscribeAudioBody;
    return json(await transcribeGroqAudio(body));
  } catch (error) {
    return errorResponse(error);
  }
}
