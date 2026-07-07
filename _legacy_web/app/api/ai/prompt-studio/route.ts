import chakraStatesBaseline from "../../../../data/chakra_states_baseline.json";
import { CONTENT_LENGTHS } from "../../../../config/contentLengths";
import { createServiceSupabase, json } from "../../_utils/supabase";
import { formatAuthorVoiceForPrompt, getAuthorVoice } from "../../_utils/authorVoice";
import { generateGeminiJson, getModelByHint } from "../../_utils/gemini";
import { getActivePrompt, renderPrompt } from "../../_utils/prompts";
import { describePetalsRelation, PLANET_TO_CHAKRA, PLANETS_7, type PetalData } from "../../_utils/topPetals";
import { buildOutputLanguageBlock } from "../../_utils/outputLanguagePrompt";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Временный тестовый стенд для шлифовки промпта «Рекомендаций на день».
 * Удалить вместе с HTML-страницей на zamkovoy.yoga после завершения итераций.
 *
 * Auth: Bearer-токен из env PROMPT_STUDIO_TOKEN (если не задан — 401).
 * CORS: https://zamkovoy.yoga (и localhost для отладки).
 *
 *  GET  ?promptKey=...          → активный промпт {promptKey, version, modelHint, temperature, maxOutputTokens, template}
 *  PATCH                          → {promptKey, template, notes?} обновить template активной строки in-place
 *  POST  generate                → собрать переменные из формы, прогнать через боевой generateGeminiJson, вернуть {slogan, short_text, long_explanation, modelUsed, renderedPrompt}
 */

// Временный стенд защищён Bearer-токеном — отражаем любой Origin, чтобы страница работала
// с любого домена размещения (zamkovoi.yoga, zamkovoy.yoga, localhost и т.д.).
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Vary": "Origin",
  };
}

function unauthorized(req: Request): Response {
  return json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders(req) });
}

function requireStudioToken(req: Request): boolean {
  const expected = process.env.PROMPT_STUDIO_TOKEN?.trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return match[1].trim() === expected;
}

const SUPPORTED_KEYS = new Set(["monologue_morning_recommendation", "global_morning_recommendation"]);

type BaselineStates = {
  harmonicStates?: string[];
  dissonantStates?: string[];
};

function shuffle<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function baselineForPlanet(planet: string): { harmonicStates: string[]; dissonantStates: string[] } {
  const baseline = (chakraStatesBaseline as Record<string, BaselineStates>)[planet] ?? {};
  // Shuffle to break LLM primacy bias (anchoring on the first words of the list),
  // so each generation emphasises a different cluster of states for the same planet.
  return {
    harmonicStates: shuffle(baseline.harmonicStates ?? []),
    dissonantStates: shuffle(baseline.dissonantStates ?? []),
  };
}

function getTone(h: number): PetalData["tone"] {
  if (Math.abs(h) < 0.2) return "ambivalent_strong";
  return h > 0 ? "harmonic" : "dissonant";
}

const FREE_PERSONALIZATION_MODE = [
  "РЕЖИМ ПЕРСОНАЛИЗАЦИИ: общий прогноз без натальной карты.",
  "Этот прогноз показывается всем пользователям бесплатного тарифа и строится ТОЛЬКО по транзитной картине дня.",
  "Никакой персонализации, никакого «у вас сегодня», никакого обращения на «ты».",
  "Только уважительное «вы» или безличная форма.",
  "Не упоминай натальную карту пользователя и не выдумывай его биографию, прошлое или обстоятельства.",
  "Активирующий транзит к натальной планете отсутствует — не упоминай его.",
].join("\n");

function buildPersonalizationModePaid(addressForm: "ty" | "vy"): string {
  const form = addressForm === "ty" ? "«ты»" : "«вы»";
  return [
    "РЕЖИМ ПЕРСОНАЛИЗАЦИИ: персональный прогноз.",
    "Это прогноз на основе натальной карты пользователя и его калибровки.",
    `Обращайся к пользователю лично, форма обращения — ${form} (задана в блоке авторского голоса выше).`,
    "Можно вплетать личные формулировки пользователя, если они уместны и попадают в тон.",
    "Учитывай активирующий транзит транзитной планеты к натальной планете — он уточняет тему дня.",
  ].join("\n");
}

type PlanetForm = {
  planet: string;
  harmoniousness: number;
  transit?: string; // только primary
  aspect?: string;  // только primary
};

function buildVariablesFromForm(
  primary: PlanetForm,
  secondary: PlanetForm,
  tertiary: PlanetForm,
  tier: "paid" | "free",
): Record<string, unknown> {
  const toPetal = (form: PlanetForm, idx: number): PetalData => {
    const planet = form.planet as PetalData["planet"];
    const entry = PLANET_TO_CHAKRA[planet];
    return {
      planet,
      chakra_number: entry?.number ?? 0,
      chakra_label: entry?.label ?? planet,
      importance: 1 - idx * 0.1,
      strength: 0.8,
      harmoniousness: form.harmoniousness,
      tone: getTone(form.harmoniousness),
      main_transit: idx === 0 ? ((form.transit || null) as PetalData["main_transit"]) : null,
      main_aspect: idx === 0 ? (form.aspect || null) : null,
      main_orb: null,
      main_activation: null,
    };
  };
  const petals = [toPetal(primary, 0), toPetal(secondary, 1), toPetal(tertiary, 2)];
  const authorVoice = formatAuthorVoiceForPrompt(getAuthorVoice("ru"), "vy");

  // В реальном free-пути (ensureGlobalDailyContent) транзита к наталу нет —
  // primary_main_transit/main_aspect пустые. Чтобы стенд честно симулировал free,
  // обнуляем их в free-режиме независимо от того, что введено в форме.
  const isFree = tier === "free";
  const [p, s, t] = petals;
  return {
    author_voice_block: authorVoice,
    personalization_mode: isFree ? FREE_PERSONALIZATION_MODE : buildPersonalizationModePaid("vy"),
    short_text_target: CONTENT_LENGTHS.SHORT_TEXT_TARGET_CHARS,
    slogan_target: CONTENT_LENGTHS.SLOGAN_TARGET_CHARS,
    long_explanation_target: CONTENT_LENGTHS.LONG_EXPLANATION_TARGET_CHARS,
    primary_planet: p.planet,
    primary_chakra: p.chakra_label,
    primary_harmoniousness: p.harmoniousness,
    primary_main_transit: isFree ? "" : (p.main_transit ?? ""),
    primary_main_aspect: isFree ? "" : (p.main_aspect ?? ""),
    secondary_planet: s.planet,
    secondary_chakra: s.chakra_label,
    secondary_harmoniousness: s.harmoniousness,
    tertiary_planet: t.planet,
    tertiary_chakra: t.chakra_label,
    tertiary_harmoniousness: t.harmoniousness,
    petals_relation: describePetalsRelation(petals),
    primary_harmonic_states: baselineForPlanet(p.planet).harmonicStates.join(", "),
    primary_dissonant_states: baselineForPlanet(p.planet).dissonantStates.join(", "),
    secondary_harmonic_states: baselineForPlanet(s.planet).harmonicStates.join(", "),
    secondary_dissonant_states: baselineForPlanet(s.planet).dissonantStates.join(", "),
    tertiary_harmonic_states: baselineForPlanet(t.planet).harmonicStates.join(", "),
    tertiary_dissonant_states: baselineForPlanet(t.planet).dissonantStates.join(", "),
    user_phrases: [],
  };
}

export async function GET(req: Request): Promise<Response> {
  if (!requireStudioToken(req)) return unauthorized(req);
  const url = new URL(req.url);
  const promptKey = (url.searchParams.get("promptKey") ?? "monologue_morning_recommendation").trim();
  if (!SUPPORTED_KEYS.has(promptKey)) {
    return json({ error: "Unsupported promptKey" }, { status: 400, headers: corsHeaders(req) });
  }
  try {
    const db = createServiceSupabase();
    const prompt = await getActivePrompt(db, promptKey);
    return json({
      promptKey: prompt.prompt_key,
      version: prompt.version,
      modelHint: prompt.model_hint,
      temperature: prompt.temperature,
      maxOutputTokens: prompt.max_output_tokens,
      template: prompt.template,
    }, { headers: corsHeaders(req) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: corsHeaders(req) });
  }
}

export async function PATCH(req: Request): Promise<Response> {
  if (!requireStudioToken(req)) return unauthorized(req);
  const cors = corsHeaders(req);
  try {
    const body = (await req.json()) as { promptKey?: string; template?: string; notes?: string };
    const promptKey = (body.promptKey ?? "").trim();
    const template = body.template ?? "";
    if (!SUPPORTED_KEYS.has(promptKey)) {
      return json({ error: "Unsupported promptKey" }, { status: 400, headers: cors });
    }
    if (!template.trim()) {
      return json({ error: "template is empty" }, { status: 400, headers: cors });
    }
    const db = createServiceSupabase();
    // v6 unified both keys to one template — keep both active rows in sync,
    // so the user iterates on a single prompt regardless of which key is selected.
    // NB: prompts table has no updated_at column (only created_at), so we don't touch it.
    const targetKeys = ["monologue_morning_recommendation", "global_morning_recommendation"];
    const { data, error } = await db
      .from("prompts")
      .update({ template, notes: body.notes ?? null })
      .in("prompt_key", targetKeys)
      .eq("is_active", true)
      .select("prompt_key,version");
    if (error) throw error;
    if (!data || data.length === 0) {
      return json({ error: "Active prompt rows not found" }, { status: 404, headers: cors });
    }
    return json({ ok: true, updated: data.map((r) => ({ promptKey: r.prompt_key, version: r.version })) }, { headers: cors });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: cors });
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!requireStudioToken(req)) return unauthorized(req);
  const cors = corsHeaders(req);
  try {
    const body = (await req.json()) as {
      promptKey?: string;
      template?: string;
      tier?: "paid" | "free";
      primary?: PlanetForm;
      secondary?: PlanetForm;
      tertiary?: PlanetForm;
    };
    const promptKey = (body.promptKey ?? "monologue_morning_recommendation").trim();
    if (!SUPPORTED_KEYS.has(promptKey)) {
      return json({ error: "Unsupported promptKey" }, { status: 400, headers: cors });
    }
    if (!body.primary || !body.secondary || !body.tertiary) {
      return json({ error: "primary, secondary, tertiary planet forms are required" }, { status: 400, headers: cors });
    }
    if (!PLANETS_7.includes(body.primary.planet as typeof PLANETS_7[number])
      || !PLANETS_7.includes(body.secondary.planet as typeof PLANETS_7[number])
      || !PLANETS_7.includes(body.tertiary.planet as typeof PLANETS_7[number])) {
      return json({ error: "Unknown planet" }, { status: 400, headers: cors });
    }

    const db = createServiceSupabase();
    const prompt = await getActivePrompt(db, promptKey);
    const template = body.template?.trim() || prompt.template;
    const tier = body.tier === "free" ? "free" : "paid";
    const variables = buildVariablesFromForm(body.primary, body.secondary, body.tertiary, tier);
    const rendered = renderPrompt(template, variables);
    const promptText = `${buildOutputLanguageBlock("ru")}\n\n${rendered}`;
    const maxOut = Math.max(prompt.max_output_tokens ?? 2200, 6144);

    const result = await generateGeminiJson<{ slogan?: string; short_text?: string; long_explanation?: string }>({
      prompt: promptText,
      model: getModelByHint(prompt.model_hint),
      temperature: prompt.temperature ?? 0.85,
      maxOutputTokens: maxOut,
    });

    return json({
      slogan: String(result.json.slogan ?? "").trim(),
      short_text: String(result.json.short_text ?? "").trim(),
      long_explanation: String(result.json.long_explanation ?? "").trim(),
      modelUsed: result.modelUsed,
      renderedPrompt: rendered,
    }, { headers: cors });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: cors });
  }
}

export async function OPTIONS(req: Request): Promise<Response> {
  return new Response("ok", { status: 204, headers: corsHeaders(req) });
}
