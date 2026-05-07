# PATCH 13 v2 [P0]: Monologue Prompts — Утренние рекомендации, портрет, развёрнутое объяснение, математический уровень

> **Версия:** 2 (заменяет ранее применённую v1)
> **Зависимости:** PATCH 8 (Author Voice), PATCH 12 (Scenarios Architecture) — уже применены
> **Право Cursor на адаптацию:** см. секцию «Инструкции для Cursor» в конце.

## Что обновлено по сравнению с v1

Полностью переработан промпт `monologue_morning_recommendation` с учётом новых требований:

1. ✅ Текст сначала на языке состояний, чакра упоминается только в финале (как мостик к практике).
2. ✅ Рекомендательный тон вместо декларативного. Не «сегодня ярче будет включена 5 чакра», а «сегодня естественно открыты темы [состояния] — на этой волне можно...».
3. ✅ Длина ~500 знаков как настраиваемый параметр приложения (`SHORT_TEXT_TARGET_LENGTH`).
4. ✅ Литературный стиль: от общего к частному, путь от «состояния → вопрос → ответ → инсайт».
5. ✅ Учёт **топ-3 лепестков Цветка дня**, а не одного. Объёмная картина дня.
6. ✅ Математический уровень формируется в том же запросе, но детерминированно из сырых данных (без LLM-токенов).

Промпт `psychological_portrait` обновлён умеренно. `deep_explanation` — теперь полный астропсихологический разбор с упоминанием авторов концепций и многоаспектной картиной дня.

⚠️ ВАЖНО: промпты длинные намеренно. Не сокращайте.

---

## 0. Общий конфигурационный параметр

Создать файл `_legacy_web/config/contentLengths.ts`:

```typescript
/**
 * Целевые длины генерируемого контента.
 * Изменяйте здесь, если нужно подкрутить визуальный баланс на главной.
 */
export const CONTENT_LENGTHS = {
  /** Слоган дня (верхний баннер главной) */
  SLOGAN_TARGET_CHARS: 50,
  SLOGAN_MAX_CHARS: 80,
  
  /** Основной блок рекомендаций на главной */
  SHORT_TEXT_TARGET_CHARS: 500,
  SHORT_TEXT_MIN_CHARS: 400,
  SHORT_TEXT_MAX_CHARS: 600,
  
  /** Развёрнутое объяснение в модальном окне «Подробнее» */
  LONG_EXPLANATION_TARGET_CHARS: 1500,
  LONG_EXPLANATION_MIN_CHARS: 1000,
  LONG_EXPLANATION_MAX_CHARS: 2500,
  
  /** Психологический портрет после натальной карты */
  PORTRAIT_TARGET_CHARS: 1000,
  PORTRAIT_MAX_CHARS: 1400,
} as const;
```

Эти значения подставляются в промпты как `{{short_text_target}}`, `{{slogan_target}}` и т.д.

---

## 1. Сборщик данных «топ-3 лепестка»

Перед вызовом утренней генерации backend готовит структурированные данные о трёх самых выделенных планетах дня.

Создать `_legacy_web/app/api/_utils/topPetals.ts`:

```typescript
import type { DailyForecast, NatalProfile, Calibration } from "./types";

const PLANET_TO_CHAKRA: Record<string, { number: number; label: string }> = {
  Moon:    { number: 1, label: "муладхара (телесность, безопасность)" },
  Venus:   { number: 2, label: "свадхистхана (удовольствие, чувственность)" },
  Mars:    { number: 3, label: "манипура (воля, действие)" },
  Jupiter: { number: 4, label: "анахата (любовь, отношения)" },
  Saturn:  { number: 5, label: "вишуддха (самовыражение, речь)" },
  Mercury: { number: 6, label: "аджна (мудрость, ясность)" },
  Sun:     { number: 7, label: "сахасрара (смысл, путь)" },
};

export interface PetalData {
  planet: string;
  chakra_number: number;
  chakra_label: string;
  importance: number;
  strength: number;
  harmoniousness: number;
  tone: "harmonic" | "dissonant" | "ambivalent_strong";
  main_transit: string | null;
  main_aspect: string | null;
}

function getTone(h: number): "harmonic" | "dissonant" | "ambivalent_strong" {
  if (Math.abs(h) < 0.2) return "ambivalent_strong";
  return h > 0 ? "harmonic" : "dissonant";
}

export function buildTopPetals(
  forecast: DailyForecast,
  natal: NatalProfile,
  calibration: Calibration | null,
  topN = 3,
): PetalData[] {
  const sorted = [...forecast.ranked_planets].sort((a, b) => b.importance - a.importance);
  
  return sorted.slice(0, topN).map((entry) => {
    const planet = entry.planet;
    const sCal = calibration?.s_calibrated?.[planet] ?? natal.planets[planet].S_initial;
    const hCal = calibration?.h_calibrated?.[planet] ?? natal.planets[planet].H_initial;
    
    return {
      planet,
      chakra_number: PLANET_TO_CHAKRA[planet].number,
      chakra_label: PLANET_TO_CHAKRA[planet].label,
      importance: round(entry.importance, 3),
      strength: round(sCal, 2),
      harmoniousness: round(hCal, 2),
      tone: getTone(hCal),
      main_transit: forecast.main_transits?.[planet]?.transit_planet ?? null,
      main_aspect: forecast.main_transits?.[planet]?.aspect_type ?? null,
    };
  });
}

export function describePetalsRelation(petals: PetalData[]): string {
  const tones = petals.map(p => p.tone);
  const harmonicCount = tones.filter(t => t === "harmonic").length;
  const dissonantCount = tones.filter(t => t === "dissonant").length;
  
  if (harmonicCount === 3) {
    return "чистая волна — все три темы поддерживают друг друга";
  }
  if (dissonantCount === 3) {
    return "тройной вызов — много энергии для глубокой работы, но требует осознанности";
  }
  if (petals[0].tone === "harmonic" && dissonantCount > 0) {
    return "поток как основа, но один из обертонов проверяет на устойчивость";
  }
  if (petals[0].tone === "dissonant" && harmonicCount > 0) {
    return "главный вызов поддержан более лёгкими резонансами — есть на что опереться";
  }
  return "смешанная картина — несколько разнородных сигналов одновременно";
}

function round(x: number, decimals: number): number {
  const k = Math.pow(10, decimals);
  return Math.round(x * k) / k;
}
```

---

## 2. Сборщик математических данных (без LLM)

Этот модуль формирует читабельный мат-блок из уже посчитанных параметров M1+M2. **LLM не задействуется** — экономия 100% токенов на этой части.

Создать `_legacy_web/app/api/_utils/mathLevelBuilder.ts`:

```typescript
import type { DailyForecast, NatalProfile, Calibration } from "./types";

export interface MathLevelData {
  /** Готовый markdown-текст для отображения в модальном окне «Математика» */
  markdown: string;
  /** Структурированные данные для UI (если хочется отрендерить отдельно) */
  structured: {
    natal_strengths: Array<{ planet: string; chakra: number; S: number; H: number; formula_summary: string }>;
    main_aspects: Array<{ from: string; to: string; type: string; orb: number; coef: number }>;
    importance_breakdown: Array<{ planet: string; activation: number; S_eff: number; importance: number }>;
    calibration_deltas?: Array<{ planet: string; dS: number; dH: number }>;
  };
}

export function buildMathLevel(
  forecast: DailyForecast,
  natal: NatalProfile,
  calibration: Calibration | null,
): MathLevelData {
  const md: string[] = [];
  const structured: MathLevelData["structured"] = {
    natal_strengths: [],
    main_aspects: [],
    importance_breakdown: [],
  };
  
  md.push("## Математика дня\n");
  md.push("Здесь — точный расчёт того, что вы видите на главной странице. Используются методы древнегреческой астрологии (эссенциальные достоинства Птолемея, акцидентальные по Лилли), скорректированные под современную психологическую модель чакр.\n");
  
  // 1. Сила и гармоничность планет
  md.push("\n### 1. Сила (S) и гармоничность (H) планет\n");
  md.push("**Формула S:** комбинация эссенциальных достоинств (управление знаком, экзальтация, термы, лица, триплицитеты) и акцидентальных факторов (положение в доме, скорость движения, восход/заход, секта). Нормализуется в диапазон [0, 1].\n");
  md.push("**Формула H:** взвешенная сумма аспектов планеты с другими светилами, с учётом орба и коэффициента типа аспекта (соединение 1.0, оппозиция 0.9, квадрат 0.8, трин 0.7, секстиль 0.5). Нормализуется в [-1, +1].\n");
  
  for (const planet of ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"]) {
    const p = natal.planets[planet];
    const sCal = calibration?.s_calibrated?.[planet];
    const hCal = calibration?.h_calibrated?.[planet];
    
    const formulaSummary = p.formula_breakdown 
      ? `E=${p.formula_breakdown.essential.toFixed(2)} + Ac=${p.formula_breakdown.accidental.toFixed(2)} → S=${p.S_initial.toFixed(2)}`
      : `S=${p.S_initial.toFixed(2)}`;
    
    md.push(`\n**${planet}** (чакра ${PLANET_TO_CHAKRA[planet].number}):`);
    md.push(`- S натальная: ${p.S_initial.toFixed(2)} (${formulaSummary})`);
    md.push(`- H натальная: ${p.H_initial.toFixed(2)}`);
    if (sCal !== undefined && Math.abs(sCal - p.S_initial) > 0.01) {
      const dS = sCal - p.S_initial;
      md.push(`- S калиброванная: ${sCal.toFixed(2)} (Δ${dS >= 0 ? '+' : ''}${dS.toFixed(2)})`);
    }
    if (hCal !== undefined && Math.abs(hCal - p.H_initial) > 0.01) {
      const dH = hCal - p.H_initial;
      md.push(`- H калиброванная: ${hCal.toFixed(2)} (Δ${dH >= 0 ? '+' : ''}${dH.toFixed(2)})`);
    }
    
    structured.natal_strengths.push({
      planet,
      chakra: PLANET_TO_CHAKRA[planet].number,
      S: sCal ?? p.S_initial,
      H: hCal ?? p.H_initial,
      formula_summary: formulaSummary,
    });
  }
  
  // 2. Активные транзитные аспекты дня
  md.push("\n### 2. Активирующие транзиты сегодня\n");
  md.push("Транзитная планета вступает в аспект с натальной — это активация темы натальной планеты на день. Вес транзита зависит от его «медлительности» (Сатурн 1.0, Юпитер 0.9, Марс 0.7, Меркурий 0.5, Венера 0.5, Луна 0.3).\n");
  
  if (forecast.main_transits) {
    for (const [natalPlanet, transitInfo] of Object.entries(forecast.main_transits)) {
      const t = transitInfo as any;
      if (!t || !t.transit_planet) continue;
      
      const aspectCoef = ASPECT_COEF[t.aspect_type] ?? 0.5;
      const transitWeight = TRANSIT_WEIGHT[t.transit_planet] ?? 0.5;
      
      md.push(`\n- Транзитный **${t.transit_planet}** ${t.aspect_type} к натальному **${natalPlanet}**`);
      md.push(`  - Орб: ${t.orb?.toFixed(2) ?? "?"}°, коэф. аспекта: ${aspectCoef}, вес транзита: ${transitWeight}`);
      md.push(`  - Активация: ${(aspectCoef * transitWeight * (1 - (t.orb ?? 0) / 8)).toFixed(3)}`);
      
      structured.main_aspects.push({
        from: t.transit_planet,
        to: natalPlanet,
        type: t.aspect_type,
        orb: t.orb ?? 0,
        coef: aspectCoef * transitWeight,
      });
    }
  }
  
  // 3. Importance — итоговый расчёт
  md.push("\n### 3. Importance — формула выбора планеты дня\n");
  md.push("**Importance(P) = Activation(P) × (0.5 + 0.5 × S_eff(P))**\n");
  md.push("Где `Activation` — суммарный вес активирующих транзитов; `S_eff` — эффективная сила (S_calibrated если есть калибровка, иначе S_initial). Множитель `0.5 + 0.5 × S_eff` обеспечивает: даже слабая планета даёт 50% активации, сильная — до 100%.\n");
  
  const ranked = [...forecast.ranked_planets].sort((a, b) => b.importance - a.importance);
  for (const entry of ranked) {
    const sEff = calibration?.s_calibrated?.[entry.planet] ?? natal.planets[entry.planet].S_initial;
    const activation = forecast.activation?.[entry.planet] ?? 0;
    md.push(`- **${entry.planet}**: Activation=${activation.toFixed(3)} × (0.5 + 0.5 × ${sEff.toFixed(2)}) = **${entry.importance.toFixed(3)}**`);
    
    structured.importance_breakdown.push({
      planet: entry.planet,
      activation,
      S_eff: sEff,
      importance: entry.importance,
    });
  }
  
  md.push("\n### 4. Выбор планеты дня");
  md.push(`Победитель: **${forecast.planet_of_the_day}** (Importance = ${forecast.importance[forecast.planet_of_the_day].toFixed(3)}).\n`);
  if (forecast.is_alternative_choice) {
    md.push(`⚠️ Использован альтернативный выбор: ${forecast.alternative_reason_text}.`);
  }
  
  // 4. Калибровка (если есть)
  if (calibration) {
    md.push("\n### 5. Дельты калибровки\n");
    md.push(`Калибровка v${calibration.version}, источник: ${calibration.source}. Применённое усреднение: ${
      calibration.source === "auto_aggregated" ? "50/50 (натальное / голосовая обратная связь)" : "60/40 (натальное / обратная связь)"
    }.\n`);
    
    structured.calibration_deltas = [];
    for (const planet of Object.keys(calibration.delta_from_initial ?? {})) {
      const delta = calibration.delta_from_initial[planet];
      if (Math.abs(delta.dS) > 0.01 || Math.abs(delta.dH) > 0.01) {
        md.push(`- ${planet}: ΔS=${delta.dS >= 0 ? '+' : ''}${delta.dS.toFixed(2)}, ΔH=${delta.dH >= 0 ? '+' : ''}${delta.dH.toFixed(2)}`);
        structured.calibration_deltas.push({ planet, dS: delta.dS, dH: delta.dH });
      }
    }
  }
  
  return {
    markdown: md.join("\n"),
    structured,
  };
}

const ASPECT_COEF: Record<string, number> = {
  conjunction: 1.0,
  opposition: 0.9,
  square: 0.8,
  trine: 0.7,
  sextile: 0.5,
};

const TRANSIT_WEIGHT: Record<string, number> = {
  Saturn: 1.0,
  Jupiter: 0.9,
  Mars: 0.7,
  Sun: 0.6,
  Mercury: 0.5,
  Venus: 0.5,
  Moon: 0.3,
};

const PLANET_TO_CHAKRA: Record<string, { number: number }> = {
  Moon: { number: 1 }, Venus: { number: 2 }, Mars: { number: 3 },
  Jupiter: { number: 4 }, Saturn: { number: 5 }, Mercury: { number: 6 }, Sun: { number: 7 },
};
```

Math-уровень собирается параллельно с вызовом LLM и возвращается клиенту в одном response. UI хранит готовый markdown и рендерит его в модальном окне (PATCH 15 опишет UI).

---

## 3. Обновлённый промпт: monologue_morning_recommendation v2

⚠️ **ВАЖНО для Cursor:** перед вставкой деактивировать v1 (`is_active = false`). Не удалять.

### 3.1. SQL-вставка

```sql
-- supabase/seeds/<timestamp>_monologue_morning_v2.sql

UPDATE public.prompts
SET is_active = false
WHERE prompt_key = 'monologue_morning_recommendation' AND is_active = true;

INSERT INTO public.prompts (
  prompt_key, prompt_type, use_case, version, is_active,
  template, variables, model_hint, temperature, max_output_tokens, response_format
) VALUES (
  'monologue_morning_recommendation', 'recommendation', NULL, 2, true,
  '{{TEMPLATE_PLACEHOLDER}}',  -- см. раздел 3.2 ниже, скопировать как есть
  '{
    "author_voice_block": {"type": "string", "required": true},
    "short_text_target": {"type": "number", "required": true},
    "slogan_target": {"type": "number", "required": true},
    "long_explanation_target": {"type": "number", "required": true},
    "primary_planet": {"type": "string", "required": true},
    "primary_chakra_number": {"type": "number", "required": true},
    "primary_chakra_label": {"type": "string", "required": true},
    "primary_strength": {"type": "number", "required": true},
    "primary_harmoniousness": {"type": "number", "required": true},
    "primary_tone": {"type": "string", "required": true},
    "primary_transit": {"type": "string", "required": false},
    "primary_aspect": {"type": "string", "required": false},
    "secondary_planet": {"type": "string", "required": true},
    "secondary_chakra_number": {"type": "number", "required": true},
    "secondary_chakra_label": {"type": "string", "required": true},
    "secondary_strength": {"type": "number", "required": true},
    "secondary_harmoniousness": {"type": "number", "required": true},
    "secondary_tone": {"type": "string", "required": true},
    "tertiary_planet": {"type": "string", "required": true},
    "tertiary_chakra_number": {"type": "number", "required": true},
    "tertiary_chakra_label": {"type": "string", "required": true},
    "tertiary_strength": {"type": "number", "required": true},
    "tertiary_harmoniousness": {"type": "number", "required": true},
    "tertiary_tone": {"type": "string", "required": true},
    "petals_relation": {"type": "string", "required": true},
    "primary_baseline_harmonic": {"type": "array", "required": true},
    "primary_baseline_dissonant": {"type": "array", "required": true},
    "secondary_baseline_harmonic": {"type": "array", "required": true},
    "secondary_baseline_dissonant": {"type": "array", "required": true},
    "tertiary_baseline_harmonic": {"type": "array", "required": true},
    "tertiary_baseline_dissonant": {"type": "array", "required": true},
    "user_phrases_for_active_chakras": {"type": "array", "required": false},
    "address_form_hint": {"type": "string", "required": true}
  }'::jsonb,
  'gemini-2.5-flash', 0.85, 2200, 'json_object'
);
```

### 3.2. Текст промпта (вставить вместо `{{TEMPLATE_PLACEHOLDER}}`)

См. секцию 3.3 — там приведён полный текст в едином блоке для копирования.

### 3.3. Полный текст промпта monologue_morning_recommendation v2

```
{{author_voice_block}}

═══════════════════════════════════════════════════════════════════
ЗАДАЧА: Сгенерируй три текста за один запрос — слоган дня (~{{slogan_target}} 
знаков), короткую рекомендацию (~{{short_text_target}} знаков), 
развёрнутое астропсихологическое объяснение (~{{long_explanation_target}} знаков).

КЛЮЧЕВАЯ ИДЕЯ: пользователь читает короткий текст и думает 
«как это близко мне сегодня». Не «гороскоп сбылся», а «эти состояния 
сейчас естественно проступают — спасибо что напомнили внимание».
═══════════════════════════════════════════════════════════════════

ОБЪЁМНАЯ КАРТИНА ДНЯ — ТОП-3 ЛЕПЕСТКА

День определяется не одной планетой, а тем, как несколько планет 
сейчас «звучат» громче других. Главная — основной тон, ещё две — 
поддерживающие или контрастирующие обертоны.

ГЛАВНЫЙ ЛЕПЕСТОК (1-й по Importance):
- Планета: {{primary_planet}} (НЕ упоминай в short_text!)
- Чакра: {{primary_chakra_number}} ({{primary_chakra_label}})
- Сила потока (S): {{primary_strength}}
- Гармоничность (H): {{primary_harmoniousness}}
- Тон: {{primary_tone}} (harmonic / dissonant / ambivalent_strong)
- Главный активирующий транзит: {{primary_transit}} {{primary_aspect}}

ВТОРОЙ ЛЕПЕСТОК (2-й по Importance):
- Планета: {{secondary_planet}}
- Чакра: {{secondary_chakra_number}} ({{secondary_chakra_label}})
- S: {{secondary_strength}}, H: {{secondary_harmoniousness}}
- Тон: {{secondary_tone}}

ТРЕТИЙ ЛЕПЕСТОК (3-й по Importance):
- Планета: {{tertiary_planet}}
- Чакра: {{tertiary_chakra_number}} ({{tertiary_chakra_label}})
- S: {{tertiary_strength}}, H: {{tertiary_harmoniousness}}
- Тон: {{tertiary_tone}}

ИНТЕГРАЦИОННЫЙ КОНТЕКСТ: {{petals_relation}}

### 3.4. Часть промпта 2/4: структура short_text

```
СТРУКТУРА SHORT_TEXT (целевая длина ~{{short_text_target}} знаков)

Это литературный микро-текст с траекторией от общего к частному. 
Структура из четырёх частей:

ЧАСТЬ 1 — ВХОД (15-20% длины, ~80-100 знаков):
Опиши ОБЩЕЕ НАСТРОЕНИЕ дня языком состояний — НЕ упоминая 
ни чакры, ни планеты. Используй авторские зачины: «Слушай», 
«Заметь», «Знаешь», «А что, если...», «Сегодня — день, когда...».

Пример: «Сегодня — день, когда внутреннее заметно тянется наружу. 
Слова и формы, которым давно пора было найтись, могут сложиться 
сами.»

ЧАСТЬ 2 — РАЗВОРОТ (25-30% длины, ~120-150 знаков):
Сделай парадоксальный или неожиданный поворот. Покажи 
ВНУТРЕННЕЕ ИЗМЕРЕНИЕ темы — что для пользователя может быть 
неочевидным. Используй регистр по тонам трёх лепестков:

При гармоничной главной: расширение возможностей, лёгкость как ресурс.
При дисгармоничной: вызов как потенциал развития, выход из автопилота.
При мощной двойственной: усиление, выбор куда направить.

Пример (гармоничная главная): «Это редкое состояние — когда 
не нужно проталкивать. Достаточно дать пространство, и оно само 
вдыхает форму.»

Пример (дисгармоничная главная): «Когда поток не идёт сам — это 
не «плохой день». Это место, где привычная инерция ломается 
и можно увидеть, как ты на самом деле собран.»

ЧАСТЬ 3 — ЯЗЫК СОСТОЯНИЙ (25-30% длины, ~120-150 знаков):
Перечисли 3-5 КОНКРЕТНЫХ состояний, которые сегодня могут быть 
актуальны. Бери из baseline главной чакры (адаптировав под H), 
вплети 1-2 личных фразы пользователя если есть и подходят. Можешь 
коротко добавить акцент со второй или третьей чакры (например, 
«+ нюанс из удовольствия» или «+ пауза для ясности»).

Пример: «Замечай — где сегодня хочется сказать прямо, где — 
показать формой, где — оставить молчание звучать. Мастерство, 
свобода речи, законченность — то, что сейчас естественно ищет 
выражения. И где-то рядом — тонкий запрос на ясность: что 
действительно стоит произнести?»

ЧАСТЬ 4 — МОСТИК К ПРАКТИКЕ (15-20% длины, ~80-100 знаков):
В САМОМ КОНЦЕ — короткое указание, на какую чакру направить 
внимание в утренней практике. ЗДЕСЬ можно назвать чакру по имени.

Шаблоны финала:
- «В утренней практике направь внимание на [имя чакры] — она 
  сегодня в фокусе.»
- «На этой волне особенно отзовётся работа с [чакра] — там 
  сегодня тонкая струна.»
- «Утренняя практика на [чакра] поможет осознанно встретить 
  этот тон.»

ПРОВЕРКА КАЧЕСТВА SHORT_TEXT (мысленный чек-лист перед выводом):
□ Длина ~{{short_text_target}} знаков (±20%)?
□ Чакра упомянута только в Части 4, не раньше?
□ Тон рекомендательный, не декларативный?
□ Использован хотя бы один авторский зачин в Части 1?
□ Часть 2 содержит парадокс или неочевидный поворот?
□ Состояния перечислены конкретно, не общими словами?
□ Если есть user_phrases — вплетены естественно?
□ Финал плавно ведёт к практике?

═══════════════════════════════════════════════════════════════════
```

### 3.5. Часть промпта 3/4: персонализация и философия тона

```
ИНСТРУМЕНТЫ ДЛЯ ПЕРСОНАЛИЗАЦИИ

Базовые состояния трёх активных чакр:

ГЛАВНАЯ ({{primary_chakra_label}}):
  Гармоничные: {{primary_baseline_harmonic}}
  Дисгармоничные: {{primary_baseline_dissonant}}

ВТОРАЯ ({{secondary_chakra_label}}):
  Гармоничные: {{secondary_baseline_harmonic}}
  Дисгармоничные: {{secondary_baseline_dissonant}}

ТРЕТЬЯ ({{tertiary_chakra_label}}):
  Гармоничные: {{tertiary_baseline_harmonic}}
  Дисгармоничные: {{tertiary_baseline_dissonant}}

Личные фразы пользователя по этим темам (вплети 1-2 если уместны 
и попадают в общий тон): {{user_phrases_for_active_chakras}}

ФОРМА ОБРАЩЕНИЯ: используй «{{address_form_hint}}»

═══════════════════════════════════════════════════════════════════
ФИЛОСОФИЯ ИМПУЛЬСА (как переводить S/H в тон рекомендации)

ВАЖНО: тон должен быть РЕКОМЕНДАТЕЛЬНЫЙ, не ДЕКЛАРАТИВНЫЙ.

❌ ПЛОХО: «Сегодня ярче обычного будет включена пятая чакра»
   (декларативно — у этого человека она вообще может не «включаться»)

✅ ХОРОШО: «На этой волне дня слова имеют особый вес. Если что-то 
   внутри просится выйти — это та форма, которая сейчас находит 
   опору в потоке»
   (рекомендательно — приглашает направить внимание, оставляя 
   человеку свободу)

КЛЮЧ: мы не утверждаем «у вас сегодня будет X». Мы говорим: 
«сегодня есть потенциал в направлении X — для тех, кто хочет 
осознанно работать с этим, открывается окно».

ИСПОЛЬЗУЙ КОНСТРУКЦИИ:
✅ «Сегодня естественно открывается тема...»
✅ «На этой волне можно...»
✅ «День располагает к [состояние]»
✅ «Сегодняшняя волна поддерживает тех, кто...»
✅ «Тонкий сигнал дня: [состояние] просит внимания»
✅ «Если откликается — то...»

❌ ИЗБЕГАЙ:
- «Сегодня вы будете чувствовать»
- «У вас активна чакра»
- «Сегодня день для»
- «Вам нужно сегодня»
- «Звёзды говорят, что»

═══════════════════════════════════════════════════════════════════
```

### 3.6. Часть промпта 4/4: slogan, long_explanation и формат вывода

```
═══════════════════════════════════════════════════════════════════
СТРУКТУРА SLOGAN (целевая длина ~{{slogan_target}} знаков)

Короткая цепляющая фраза в авторском стиле — на верхний баннер 
главной. НЕ заголовок «Сегодня день анахаты», а импульс.

✅ Хорошие:
- «Сегодня — день, когда красота сама ищет вас»
- «Колесо качнулось, поток собирает в путь»
- «Сегодня — время осознавать, что тащится за собой»
- «День мягкий — пользуйтесь»

❌ Плохие:
- «Активна чакра 4, гармонично» (технично)
- «Хорошего дня!» (плоско)
- «Сегодня важный день для развития» (общё)

═══════════════════════════════════════════════════════════════════
СТРУКТУРА LONG_EXPLANATION (целевая длина ~{{long_explanation_target}} знаков)

Это РАЗВЁРНУТЫЙ АСТРОПСИХОЛОГИЧЕСКИЙ РАЗБОР — содержательный 
текст, который пользователь читает, нажав «Подробнее». Здесь МОЖНО 
упоминать планеты, аспекты, транзиты — но в живом, повествовательном 
ключе.

Структура из шести смысловых блоков:

§1. ОБЩАЯ КАРТИНА ДНЯ (~250 знаков):
Описательным языком — что показано в Цветке дня. Какие планеты 
сегодня выделены, какие аспекты их активируют. Перечисли все три 
лепестка с их S и H. Без формул — просто «Юпитер силён и гармоничен 
(сила 0.78), плюс активирующий трин от транзитного Сатурна — это 
формирует тон дня...».

§2. ГЛАВНАЯ ТЕМА (~300 знаков):
Углубление в тему {{primary_planet}}. Объясни:
- Что эта планета в психологической модели обозначает (через чакру).
- Какой именно транзит её активирует и почему это значимо.
- Если is_harmonic: почему это ресурсный день для этой темы.
- Если is_dissonant: почему это вызов с потенциалом развития.

§3. ВТОРОЙ ЛЕПЕСТОК (~200 знаков):
Как тема {{secondary_planet}} (через чакру {{secondary_chakra_label}}) 
обертоном звучит сегодня. Усиливает главную, контрастирует, добавляет 
оттенок?

§4. ТРЕТИЙ ЛЕПЕСТОК (~200 знаков):
То же для {{tertiary_planet}} — как третий обертон вплетается 
в общую картину.

§5. КОНЦЕПТУАЛЬНАЯ ОПОРА (~200 знаков, ОПЦИОНАЛЬНО):
Если есть редкий или показательный нюанс — упомяни его и сошлись 
на источник. Например: «Это классический пример того, что Лилли 
называл „благосклонным взором“» / «По методу Порфирия дома считаются 
от Асцендента, что даёт особую точность в этой конфигурации» / 
«Птолемей в "Тетрабиблосе" описывал такие моменты как...». 
Не перегружай — 1 ссылка достаточно.

§6. ЗАКЛЮЧЕНИЕ С МОСТИКОМ (~150 знаков):
Соедини три лепестка в одну общую картину одной-двумя фразами. 
В самом конце — приглашение перейти к следующему уровню («Хотите 
увидеть точные расчёты сил планет и весов аспектов? Откройте 
математический уровень.»).

ТОН long_explanation: уважительный к традиции, но живой. НЕ 
учебник по астрологии. Это разговор эксперта, который любит 
дело и хочет поделиться внутренней механикой.

═══════════════════════════════════════════════════════════════════
ФОРМАТ ОТВЕТА: строгий JSON без markdown-обёртки:

{
  "slogan": "<5-12 слов>",
  "short_text": "<~{{short_text_target}} знаков, четыре части>",
  "long_explanation": "<~{{long_explanation_target}} знаков, шесть блоков>"
}

═══════════════════════════════════════════════════════════════════
```

---

## 4. Обновление обработчика /api/ai/monologue

В обработчике `/api/ai/monologue` для сценария `morning_recommendation` нужно:

1. Вызвать `buildTopPetals()` — получить структурированные данные о трёх лепестках.
2. Вызвать `buildMathLevel()` — получить готовый markdown математики (без LLM).
3. Вызвать LLM с правильно подготовленным набором переменных.
4. Вернуть клиенту объединённый ответ: `{slogan, short_text, long_explanation, math_level: { markdown, structured }, cached}`.

Псевдокод:

```typescript
// _legacy_web/app/api/ai/monologue/route.ts (обновление для morning_recommendation)

if (scenario.id === 'morning_recommendation') {
  const [forecast, natal, calibration] = await Promise.all([
    loadForecast(userId, todayLocal),
    loadActiveNatalChart(userId),
    loadActiveCalibration(userId),
  ]);
  
  // 1. Топ-3 лепестка
  const petals = buildTopPetals(forecast, natal, calibration, 3);
  const petalsRelation = describePetalsRelation(petals);
  
  // 2. Базовые состояния для трёх чакр
  const baselineForChakra = (planet) => 
    chakraStatesBaseline[planet] ?? { harmonicStates: [], dissonantStates: [] };
  
  // 3. Личные фразы по активным чакрам
  const userPhrases = (calibration?.user_lexicon?.phrases ?? [])
    .filter(p => petals.some(petal => petal.planet === p.associated_planet))
    .slice(0, 5)
    .map(p => p.text);
  
  // 4. Author voice + addressing
  const language = (user.locale ?? "ru").slice(0, 2);
  const authorVoice = formatAuthorVoiceForPrompt(getAuthorVoice(language), 
    user.address_form === "informal" ? "ty" : "vy");
  
  const variables = {
    author_voice_block: authorVoice,
    short_text_target: CONTENT_LENGTHS.SHORT_TEXT_TARGET_CHARS,
    slogan_target: CONTENT_LENGTHS.SLOGAN_TARGET_CHARS,
    long_explanation_target: CONTENT_LENGTHS.LONG_EXPLANATION_TARGET_CHARS,
    
    primary_planet: petals[0].planet,
    primary_chakra_number: petals[0].chakra_number,
    primary_chakra_label: petals[0].chakra_label,
    primary_strength: petals[0].strength,
    primary_harmoniousness: petals[0].harmoniousness,
    primary_tone: petals[0].tone,
    primary_transit: petals[0].main_transit,
    primary_aspect: petals[0].main_aspect,
    
    secondary_planet: petals[1].planet,
    secondary_chakra_number: petals[1].chakra_number,
    secondary_chakra_label: petals[1].chakra_label,
    secondary_strength: petals[1].strength,
    secondary_harmoniousness: petals[1].harmoniousness,
    secondary_tone: petals[1].tone,
    
    tertiary_planet: petals[2].planet,
    tertiary_chakra_number: petals[2].chakra_number,
    tertiary_chakra_label: petals[2].chakra_label,
    tertiary_strength: petals[2].strength,
    tertiary_harmoniousness: petals[2].harmoniousness,
    tertiary_tone: petals[2].tone,
    
    petals_relation: petalsRelation,
    primary_baseline_harmonic: baselineForChakra(petals[0].planet).harmonicStates,
    primary_baseline_dissonant: baselineForChakra(petals[0].planet).dissonantStates,
    secondary_baseline_harmonic: baselineForChakra(petals[1].planet).harmonicStates,
    secondary_baseline_dissonant: baselineForChakra(petals[1].planet).dissonantStates,
    tertiary_baseline_harmonic: baselineForChakra(petals[2].planet).harmonicStates,
    tertiary_baseline_dissonant: baselineForChakra(petals[2].planet).dissonantStates,
    
    user_phrases_for_active_chakras: userPhrases,
    address_form_hint: user.address_form === "informal" ? "ты" : "вы",
  };
  
  // 5. LLM (только slogan + short + long, NO математика!)
  const llmResult = await generateGeminiJson({
    prompt: renderPrompt(prompt.template, variables),
    model: prompt.model_hint,
    temperature: prompt.temperature,
    maxTokens: prompt.max_output_tokens,
    responseFormat: 'json_object',
  });
  
  // 6. Math level — детерминированно, без LLM
  const mathLevel = buildMathLevel(forecast, natal, calibration);
  
  // 7. Финальный response (объединённый)
  return NextResponse.json({
    slogan: llmResult.slogan,
    short_text: llmResult.short_text,
    long_explanation: llmResult.long_explanation,
    math_level: mathLevel,
    cached: false,
    scenario_id: 'morning_recommendation',
  });
}
```

В кеш `scenario_cache` сохраняется ВСЯ структура (включая `math_level`), чтобы при повторном открытии в течение дня не пересчитывать заново.

---

## 5. Обновление psychological_portrait

Изменения минимальные — только использование constant из `CONTENT_LENGTHS`:

```sql
UPDATE public.prompts
SET template = REPLACE(template, '{{portrait_target_chars}}', '1000')
WHERE prompt_key = 'monologue_psychological_portrait' AND is_active = true;
```

В переменные промпта добавить `portrait_target_chars: CONTENT_LENGTHS.PORTRAIT_TARGET_CHARS`.

Структурно промпт остаётся тем же — он уже хорошо работает.

---

## 6. Обновление deep_explanation

Промпт `monologue_deep_explanation` теперь дублирует функцию `long_explanation` из `morning_recommendation`. Решение: **деактивировать его** как отдельный сценарий и использовать `long_explanation` из morning-генерации.

```sql
UPDATE public.prompts
SET is_active = false
WHERE prompt_key = 'monologue_deep_explanation' AND is_active = true;

UPDATE public.scenarios
SET is_active = false
WHERE id = 'deep_explanation';
```

Если в коде есть ссылки на сценарий `deep_explanation` — заменить их на чтение из кеша `morning_recommendation` (берём из него поле `long_explanation`).

---

## 7. Тесты

```typescript
// _legacy_web/app/api/_utils/topPetals.test.ts

describe("buildTopPetals", () => {
  it("returns top 3 by importance", () => {
    const forecast = {
      ranked_planets: [
        { planet: "Sun", importance: 0.5 },
        { planet: "Saturn", importance: 0.8 },
        { planet: "Moon", importance: 0.3 },
        { planet: "Mars", importance: 0.6 },
      ],
      // ...
    };
    const petals = buildTopPetals(forecast, mockNatal, null, 3);
    expect(petals[0].planet).toBe("Saturn");
    expect(petals[1].planet).toBe("Mars");
    expect(petals[2].planet).toBe("Sun");
  });
  
  it("uses calibrated values when available", () => {
    const calibration = { 
      s_calibrated: { Saturn: 0.85, Sun: 0.4, Mars: 0.6, Moon: 0.5, Venus: 0.5, Mercury: 0.5, Jupiter: 0.5 }, 
      h_calibrated: { Saturn: 0.3, Sun: 0.0, Mars: -0.4, Moon: 0.0, Venus: 0.0, Mercury: 0.0, Jupiter: 0.0 },
    };
    const petals = buildTopPetals(forecast, mockNatal, calibration, 3);
    expect(petals[0].strength).toBe(0.85);
    expect(petals[0].harmoniousness).toBe(0.3);
    expect(petals[0].tone).toBe("harmonic");
  });
  
  it("describePetalsRelation returns correct labels", () => {
    const allHarmonic = [
      { tone: "harmonic" }, { tone: "harmonic" }, { tone: "harmonic" }
    ] as PetalData[];
    expect(describePetalsRelation(allHarmonic)).toContain("чистая волна");
  });
});

// _legacy_web/app/api/_utils/mathLevelBuilder.test.ts

describe("buildMathLevel", () => {
  it("returns markdown with all sections", () => {
    const result = buildMathLevel(mockForecast, mockNatal, null);
    expect(result.markdown).toContain("Сила (S) и гармоничность (H)");
    expect(result.markdown).toContain("Активирующие транзиты");
    expect(result.markdown).toContain("Importance");
    expect(result.markdown).toContain("Выбор планеты дня");
  });
  
  it("includes calibration deltas when calibration present", () => {
    const result = buildMathLevel(mockForecast, mockNatal, mockCalibration);
    expect(result.markdown).toContain("Дельты калибровки");
    expect(result.structured.calibration_deltas).toBeDefined();
  });
  
  it("structured.natal_strengths has all 7 planets", () => {
    const result = buildMathLevel(mockForecast, mockNatal, null);
    expect(result.structured.natal_strengths).toHaveLength(7);
  });
});
```

---

## 8. Тестовые сценарии полного flow

### Сценарий A: Гармоничный главный + два гармоничных обертона
**Вход:** primary=Jupiter, harmonic; secondary=Sun, harmonic; tertiary=Venus, harmonic.
**Ожидание:**
- petals_relation = "чистая волна — все три темы поддерживают друг друга"
- short_text часть 2 — лёгкий тон («не нужно проталкивать»)
- short_text часть 4 — мостик к практике на анахату

### Сценарий B: Дисгармоничный главный + смесь обертонов
**Вход:** primary=Saturn, dissonant; secondary=Mercury, harmonic; tertiary=Mars, dissonant.
**Ожидание:**
- petals_relation про «вызов с поддержкой ясности»
- short_text часть 2 — про вызов как потенциал
- long_explanation про взаимодействие Saturn-Mars напряжения с Mercury-ясностью

### Сценарий C: Все три дисгармоничны
**Вход:** primary=Mars, dissonant; secondary=Saturn, dissonant; tertiary=Moon, dissonant.
**Ожидание:**
- petals_relation = "тройной вызов — много энергии для глубокой работы"
- short_text часть 2 особенно осознанным тоном
- Не должно быть фатализма! Тон рекомендательный.

### Сценарий D: Длина soft cap
**Ожидание:** short_text 400-600 знаков. Если LLM выдаёт 700+ — попадание в выдачу всё равно (max 600 — soft предел), но в логи warning о превышении.

---

## 9. Инструкции для Cursor

### Право на адаптацию

Cursor **может корректировать** этот патч в следующих случаях:
1. Если структура `forecast.ranked_planets` или `forecast.main_transits` отличается от описанной в моём шаблоне — адаптировать `buildTopPetals` под реальную форму данных.
2. Если в БД уже есть таблица или функция с похожим именем — **не пересоздавать**, использовать существующую.
3. Если уже сделаны доработки `morning_recommendation` промпта поверх v1, которых я не знаю — **сохранить их в новом v2**, добавив пометку «// CUSTOM: ...» в комментариях SQL.
4. Если `chakra_states_baseline.json` имеет другую структуру (вместо `harmonicStates`/`dissonantStates`) — адаптировать обращения к нему.

### Что НЕ менять

- ❌ Не сокращать длину промпта v2 (он намеренно подробный — это влияет на качество).
- ❌ Не менять структуру short_text из 4 частей.
- ❌ Не убирать запрет на упоминание чакры до части 4.
- ❌ Не убирать чек-листы качества.
- ❌ Не менять список «Используй конструкции / Избегай».

### Порядок применения

1. Создать `config/contentLengths.ts`.
2. Создать `_utils/topPetals.ts` + тесты.
3. Создать `_utils/mathLevelBuilder.ts` + тесты.
4. Применить SQL-миграцию (деактивация v1, вставка v2 промпта).
5. Обновить обработчик `/api/ai/monologue` для `morning_recommendation`.
6. Деактивировать `deep_explanation` сценарий и его промпт.
7. Обновить frontend-hook `useMorningContent()` чтобы он также возвращал `math_level`.
8. Smoke-тест: открыть главную в dev-окружении, проверить что short_text ~500 знаков, чакра только в финале, тон рекомендательный.

---

## 10. Критерий приёмки

- ✅ Новая v2 версия `monologue_morning_recommendation` активна в БД, v1 деактивирована.
- ✅ Создан `topPetals.ts` с функциями `buildTopPetals()` и `describePetalsRelation()`.
- ✅ Создан `mathLevelBuilder.ts` с функцией `buildMathLevel()`.
- ✅ В `/api/ai/monologue` для morning сценария вычисляются три лепестка и math level.
- ✅ Response endpoint содержит поля `slogan`, `short_text`, `long_explanation`, `math_level`.
- ✅ В smoke-тесте: `short_text` имеет длину 400-600 знаков.
- ✅ В smoke-тесте: чакра упоминается ТОЛЬКО в последнем абзаце short_text.
- ✅ В smoke-тесте: long_explanation содержит описание всех трёх лепестков.
- ✅ Все unit-тесты проходят.
- ✅ Сценарий `deep_explanation` деактивирован.
- ✅ Кеш `morning_recommendation` хранит весь объединённый response (включая math).
