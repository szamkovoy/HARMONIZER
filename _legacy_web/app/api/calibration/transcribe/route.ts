import { errorResponse, json, requireUserId } from "../../_utils/supabase";
import { transcribeWhisperAudio, type TranscribeAudioBody } from "../../_utils/whisperTranscription";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await requireUserId(req);
    const body = (await req.json()) as TranscribeAudioBody;
    return json(await transcribeWhisperAudio(body));
  } catch (error) {
    return errorResponse(error);
  }
}
