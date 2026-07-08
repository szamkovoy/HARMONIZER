import { generateGeminiJson, generateGeminiText, getModelByHint } from "../../../_utils/gemini";
import { renderPrompt } from "../../../_utils/prompts";
import { errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

type TestPayload = {
  template?: string;
  variables?: Record<string, unknown>;
  model_hint?: string | null;
  temperature?: number | null;
  max_output_tokens?: number | null;
  response_format?: string | null;
};

/**
 * Playground: рендерит шаблон с переданными переменными и гоняет через боевой
 * Gemini-пайплайн (с цепочкой fallback-моделей). Ничего не пишет в БД.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const payload = (await req.json()) as TestPayload;
    const template = payload.template?.trim() ?? "";
    if (!template) return json({ error: "Шаблон пуст" }, { status: 400 });

    const variables = payload.variables ?? {};
    const rendered = renderPrompt(template, variables);
    const model = getModelByHint(payload.model_hint);
    const temperature = payload.temperature ?? 0.85;
    const maxOutputTokens = payload.max_output_tokens ?? 4096;

    const startedAt = Date.now();
    if (payload.response_format === "json_object") {
      const result = await generateGeminiJson<Record<string, unknown>>({
        prompt: rendered,
        model,
        temperature,
        maxOutputTokens,
      });
      return json({
        renderedPrompt: rendered,
        output: JSON.stringify(result.json, null, 2),
        modelUsed: result.modelUsed,
        latencyMs: Date.now() - startedAt,
      });
    }

    const result = await generateGeminiText({
      prompt: rendered,
      model,
      temperature,
      maxOutputTokens,
    });
    return json({
      renderedPrompt: rendered,
      output: result.text,
      modelUsed: result.modelUsed,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
