import { errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { assertStoryUploadSize, storyUploadKindFromMime } from "../mediaPipeline";
import { writeStoryUploadChunk } from "../uploadSession";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const form = await req.formData();
    const sessionId = String(form.get("session_id") ?? "").trim();
    const chunkIndex = Number(form.get("chunk_index"));
    const chunkTotal = Number(form.get("chunk_total"));
    const contentType = String(form.get("content_type") ?? "").trim();
    const bytes = Number(form.get("bytes"));
    const chunkEntry = form.get("chunk");

    if (!sessionId) {
      return json({ error: "Не указан session_id" }, { status: 400 });
    }
    if (!(chunkEntry instanceof Blob)) {
      return json({ error: "Не передана часть файла" }, { status: 400 });
    }
    if (!contentType) {
      return json({ error: "Не указан content_type" }, { status: 400 });
    }

    assertStoryUploadSize(storyUploadKindFromMime(contentType), bytes);

    const chunkBuffer = Buffer.from(await chunkEntry.arrayBuffer());
    await writeStoryUploadChunk(sessionId, chunkIndex, chunkTotal, contentType, bytes, chunkBuffer);

    return json({ ok: true, chunk_index: chunkIndex, chunk_total: chunkTotal });
  } catch (error) {
    return errorResponse(error);
  }
}
