-- Breath practice interpretation → admin /prompts + runtime via getActivePrompt.
-- Key: breath_practice_interpretation
-- Playground: {{language_name}} + {{outcome}} (realistic session JSON with seriesInsights).

insert into public.prompts (
  prompt_key,
  prompt_type,
  use_case,
  version,
  is_active,
  template,
  variables,
  model_hint,
  temperature,
  max_output_tokens,
  response_format,
  notes
) values
(
  'breath_practice_interpretation',
  'system',
  null,
  1,
  true,
  $prompt$OUTPUT LANGUAGE: {{language_name}}.
Write the entire answer in {{language_name}}.

You are an empathetic HARMONIZER breathing-practice mentor interpreting one completed session for a woman aged 35–60.
Your goal is to encourage her and gently motivate continued practice — the text should feel warm, hopeful, and supportive.
Use only the supplied JSON. Do not invent metrics, symptoms, or causal claims.
If seriesInsights are present, use ONLY the metrics that appear in seriesInsights. Compare start/mid/end averages and mention at most 1–2 clear POSITIVE or NEUTRAL dynamics. Do NOT mention, reference, or speculate about any metric that is absent from seriesInsights — if a metric is missing from seriesInsights it was intentionally excluded and you must not read its value from elsewhere in the payload.
If hybrid.start and hybrid.end are present, briefly compare how the state changed from the beginning to the end, only when supported by the numbers.
Do not turn every metric into a mini-report. Prefer one concise takeaway over listing all ranges.
If detailed biometrics are missing, hidden, or null, say that clearly and avoid pretending that HRV/coherence/RSA were measured.
If this looks like camera guidance-only mode, explain that the rhythm could still guide breathing but advanced biometrics were unavailable in this session.
NEVER claim or imply that the user is a beginner, that this is a new technique for them, or that they are 'first learning' the practice. You do not know their experience level.
Keep the tone calm, warm, and grounded. No diagnosis, no treatment advice, no headings, no bullet list, no markdown.
Reply in 4–7 sentences, ideally split into 2 short paragraphs.

Practice result payload:
{{outcome}}$prompt$,
  jsonb_build_object(
    'language_name', 'Russian',
    'outcome', jsonb_build_object(
      'kind', 'breath-practice-outcome',
      'input', jsonb_build_object(
        'practiceId', 'box_breathing',
        'durationMs', 300000,
        'chakra', 3,
        'locale', 'ru'
      ),
      'summary', jsonb_build_object(
        'durationMs', 300000,
        'pulseEmulated', false,
        'avgPulseBpm', 78.4,
        'coherenceAveragePercent', 62.1,
        'coherenceMaxPercent', 84.0,
        'rsaAmplitudeBpm', 6.2,
        'rsaNormalizedPercent', 48.0,
        'rmssdMs', 17.1,
        'stressPercent', 51.0,
        'entryTimeSec', 94
      ),
      'hybrid', null,
      'seriesInsights', jsonb_build_object(
        'pulseBpm', jsonb_build_object(
          'unit', 'bpm',
          'sampleCount', 48,
          'startMean', 83.0,
          'midMean', 86.2,
          'endMean', 82.8,
          'min', 74.0,
          'max', 91.0,
          'endMinusStart', -0.2,
          'peakAtSec', 148,
          'troughAtSec', 276
        ),
        'coherencePercent', jsonb_build_object(
          'unit', 'percent',
          'sampleCount', 36,
          'startMean', 38.0,
          'midMean', 55.0,
          'endMean', 74.0,
          'min', 22.0,
          'max', 84.0,
          'endMinusStart', 36.0,
          'peakAtSec', 262,
          'troughAtSec', 28
        ),
        'rmssdMs', jsonb_build_object(
          'unit', 'ms',
          'sampleCount', 36,
          'startMean', 16.0,
          'midMean', 14.5,
          'endMean', 18.0,
          'min', 12.0,
          'max', 21.0,
          'endMinusStart', 2.0,
          'peakAtSec', 288,
          'troughAtSec', 156
        ),
        'stressPercent', jsonb_build_object(
          'unit', 'percent',
          'sampleCount', 36,
          'startMean', 56.0,
          'midMean', 52.0,
          'endMean', 47.0,
          'min', 44.0,
          'max', 61.0,
          'endMinusStart', -9.0,
          'peakAtSec', 34,
          'troughAtSec', 292
        ),
        'rsaAmplitudeBpm', jsonb_build_object(
          'unit', 'bpm',
          'sampleCount', 30,
          'startMean', 4.1,
          'midMean', 5.4,
          'endMean', 7.0,
          'min', 2.8,
          'max', 8.2,
          'endMinusStart', 2.9,
          'peakAtSec', 270,
          'troughAtSec', 40
        )
      )
    )
  ),
  'standard',
  0.4,
  420,
  'text',
  'Рабочий промпт интерпретации результатов дыхательной практики (POST /api/communicator/v2/practice-interpretation). Playground: {{language_name}} + {{outcome}}. Сид — реалистичная 5‑мин сессия с seriesInsights.'
)
on conflict (prompt_key, version) do update set
  template = excluded.template,
  variables = excluded.variables,
  model_hint = excluded.model_hint,
  temperature = excluded.temperature,
  max_output_tokens = excluded.max_output_tokens,
  response_format = excluded.response_format,
  notes = excluded.notes,
  is_active = excluded.is_active;
