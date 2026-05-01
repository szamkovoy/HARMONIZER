import type { SupabaseClient } from "@supabase/supabase-js";
import { generateGeminiJson, getModelByHint } from "../../_utils/gemini";
import { reportRouteError } from "../../_utils/monitoring";
import { getActivePrompt, renderPrompt } from "../../_utils/prompts";
import { checkScenarioCache, saveScenarioCache } from "../../_utils/scenarioCache";
import { getScenario } from "../../_utils/scenarios";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";

export const runtime = "nodejs";

type Body = {
  scenario_id?: string;
  variables?: Record<string, unknown>;
};

export async function POST(req: Request) {
  let db: SupabaseClient | null = null;
  let userId: string | null = null;
  let endpointStage = "request";
  try {
    userId = await requireUserId(req);
    const body = (await req.json()) as Body;
    const scenarioId = body.scenario_id?.trim();
    if (!scenarioId) return json({ error: "scenario_id is required" }, { status: 400 });

    db = createServiceSupabase();
    endpointStage = "load_scenario";
    const scenario = await getScenario(scenarioId, db);
    if (!scenario) return json({ error: "Scenario not found" }, { status: 404 });
    if (scenario.scenario_type !== "monologue") {
      return json({ error: "This endpoint is for monologue scenarios. Use /api/ai/dialog for dialogues." }, { status: 400 });
    }
    if (!scenario.monologue_prompt_key) {
      return json({ error: "Scenario has no monologue prompt configured" }, { status: 500 });
    }

    endpointStage = "cache_lookup";
    const cached = await checkScenarioCache<Record<string, unknown>>(scenario, userId, db);
    if (cached) {
      return json({
        ...cached,
        cached: true,
        scenario_id: scenario.id,
      });
    }

    endpointStage = "load_prompt";
    const prompt = await getActivePrompt(db, scenario.monologue_prompt_key);

    endpointStage = "generate";
    const result = await generateGeminiJson<Record<string, unknown>>({
      prompt: renderPrompt(prompt.template, body.variables ?? {}),
      model: getModelByHint(prompt.model_hint),
      temperature: prompt.temperature,
      maxOutputTokens: prompt.max_output_tokens,
    });
    const payload = {
      ...result.json,
      modelUsed: result.modelUsed,
    };

    endpointStage = "cache_save";
    await saveScenarioCache(scenario, userId, payload, db);

    return json({
      ...payload,
      cached: false,
      scenario_id: scenario.id,
    });
  } catch (error) {
    await reportRouteError(error, {
      db,
      userId,
      endpoint: "ai/monologue",
      stage: endpointStage,
    });
    return errorResponse(error);
  }
}
