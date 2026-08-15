/**
 * Literary chapter translation via premium LLM.
 *
 *   node scripts/book-translate.mjs --locale fr
 *   node scripts/book-translate.mjs --locale es --only 005-prologue
 *   node scripts/book-translate.mjs --locale it --concurrency 2
 *   node scripts/book-translate.mjs --all
 *   node scripts/book-translate.mjs --all --provider gemini --model gemini-3.1-pro-preview
 *
 * Providers:
 *   - deepseek (default if AI_MODEL_PREMIUM is deepseek-*): DEEPSEEK_API_KEY
 *   - gemini: GEMINI_API_KEY (preferred for literary quality when DeepSeek balance is empty)
 *
 * Resume-safe: skips chapters that already exist under book/translations/{locale}/chapters/.
 */
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Cursor sandbox / corporate HTTP(S)_PROXY: make global fetch honor the proxy.
try {
  setGlobalDispatcher(new EnvHttpProxyAgent());
} catch {
  /* undici optional at runtime */
}

const LOCALES = {
  fr: {
    language: "French",
    hint: "France — littéraire, clair, sans anglicismes inutiles",
    tocHeading: "# Table des matières",
  },
  it: {
    language: "Italian",
    hint: "Italia — prosa letteraria naturale",
    tocHeading: "# Indice",
  },
  es: {
    language: "Spanish",
    hint: "español internacional (España/LatAm neutro), literario",
    tocHeading: "# Índice",
  },
  pt: {
    language: "Portuguese",
    hint: "português europeu, registo literário acessível",
    tocHeading: "# Índice",
  },
  nl: {
    language: "Dutch",
    hint: "Nederlands (Nederland) — natuurlijk literair",
    tocHeading: "# Inhoudsopgave",
  },
};

function loadEnvLocal() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2] ?? "";
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function parseArgs(argv) {
  /** @type {{ locales: string[], only: string | null, concurrency: number, force: boolean, provider: string | null, model: string | null }} */
  const out = {
    locales: [],
    only: null,
    concurrency: 2,
    force: false,
    provider: null,
    model: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") out.locales = Object.keys(LOCALES);
    else if (a === "--locale") out.locales.push(String(argv[++i] || "").toLowerCase());
    else if (a === "--only") out.only = String(argv[++i] || "");
    else if (a === "--concurrency") out.concurrency = Math.max(1, Number(argv[++i]) || 2);
    else if (a === "--force") out.force = true;
    else if (a === "--provider") out.provider = String(argv[++i] || "").toLowerCase();
    else if (a === "--model") out.model = String(argv[++i] || "");
  }
  out.locales = [...new Set(out.locales.filter(Boolean))];
  return out;
}

function resolveProvider(args) {
  if (args.provider === "gemini" || args.provider === "deepseek") return args.provider;
  const premium = (process.env.AI_MODEL_PREMIUM || "").toLowerCase();
  if (premium.startsWith("deepseek-")) {
    // Prefer Gemini Pro when DeepSeek is set but may be unpaid; caller can force --provider deepseek.
    if (process.env.BOOK_TRANSLATE_PROVIDER) {
      return String(process.env.BOOK_TRANSLATE_PROVIDER).toLowerCase();
    }
  }
  if (args.provider) return args.provider;
  // Default for this book job: Gemini 3.1 Pro (literary quality).
  return process.env.GEMINI_API_KEY ? "gemini" : "deepseek";
}

function resolveModel(provider, args) {
  if (args.model) return args.model;
  if (provider === "gemini") {
    return process.env.BOOK_TRANSLATE_MODEL?.trim() || "gemini-3.1-pro-preview";
  }
  return process.env.AI_MODEL_PREMIUM?.trim() || "deepseek-v4-pro";
}

function ensureEnChapters() {
  const manifest = join(root, "book/translations/en/chapters/manifest.json");
  if (existsSync(manifest)) return;
  console.log("Splitting EN chapters…");
  const r = spawnSync(process.execPath, [join(root, "scripts/book-split-chapters.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function loadPromptTemplate() {
  return readFileSync(join(root, "scripts/book-translate-prompt.md"), "utf8");
}

function buildSystemPrompt(locale) {
  const cfg = LOCALES[locale];
  return loadPromptTemplate()
    .replaceAll("{{TARGET_LANGUAGE}}", cfg.language)
    .replaceAll("{{TARGET_LOCALE_HINT}}", cfg.hint)
    .replaceAll("{{LOCALE}}", locale);
}

function stripFences(text) {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/, "");
  }
  return t.trim() + "\n";
}

function rewriteLocaleUrls(md, locale) {
  return md
    .replaceAll("https://zamkovoi.yoga/en", `https://zamkovoi.yoga/${locale}`)
    .replaceAll("https://zamkovoi.yoga/yoga36en", `https://zamkovoi.yoga/yoga36${locale}`)
    .replaceAll("https://zamkovoi.yoga/yoga7en", `https://zamkovoi.yoga/yoga7${locale}`);
}

function buildUserPrompt(locale, chapter, source) {
  return [
    `Target language: ${LOCALES[locale].language} (locale code ${locale})`,
    `Chapter id: ${chapter.id}`,
    `Chapter title (EN): ${chapter.title}`,
    "",
    "=== SOURCE (English Markdown) ===",
    source,
    "",
    "Remember: output only the translated Markdown. Preserve image paths and Markdown structure.",
  ].join("\n");
}

async function translateChapterDeepseek({ locale, chapter, systemPrompt, model, apiKey, baseURL, source }) {
  const user = buildUserPrompt(locale, chapter, source);
  const url = `${baseURL.replace(/\/$/, "")}/chat/completions`;
  const maxTokens = Math.min(16000, Math.max(4096, Math.ceil(source.length / 2) + 2000));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.55,
      max_tokens: maxTokens,
      thinking: { type: "disabled" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${chapter.id}: ${errBody.slice(0, 500)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`Empty response for ${chapter.id}`);
  }
  return rewriteLocaleUrls(stripFences(content), locale);
}

async function translateChapterGemini({ locale, chapter, systemPrompt, model, apiKey, source }) {
  const user = buildUserPrompt(locale, chapter, source);
  // gemini-3.1-pro runs in thinking mode; thoughts count against the output budget.
  const maxTokens = 32768;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.55,
        maxOutputTokens: maxTokens,
        thinkingConfig: { thinkingBudget: 1024 },
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${chapter.id}: ${errBody.slice(0, 500)}`);
  }
  const data = await res.json();
  const cand = data?.candidates?.[0];
  const parts = cand?.content?.parts;
  const content = Array.isArray(parts)
    ? parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("")
    : "";
  if (!content.trim()) {
    const block = cand?.finishReason || data?.promptFeedback || "empty";
    throw new Error(`Empty Gemini response for ${chapter.id}: ${JSON.stringify(block).slice(0, 200)}`);
  }
  const finish = String(cand?.finishReason || "");
  if (finish && finish !== "STOP") {
    throw new Error(`Incomplete Gemini response for ${chapter.id}: finishReason=${finish}`);
  }
  const outWords = content.split(/\s+/).filter(Boolean).length;
  const srcWords = source.split(/\s+/).filter(Boolean).length;
  if (srcWords > 120 && outWords < Math.floor(srcWords * 0.45)) {
    throw new Error(
      `Truncated/short translation for ${chapter.id}: ${outWords}w vs source ${srcWords}w`,
    );
  }
  return rewriteLocaleUrls(stripFences(content), locale);
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

class QuotaExhaustedError extends Error {
  /** @param {string} message @param {number} retryAfterMs */
  constructor(message, retryAfterMs) {
    super(message);
    this.name = "QuotaExhaustedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** @returns {number | null} ms to wait, or null if not a daily quota error */
function parseDailyQuotaWaitMs(msg) {
  if (!/per_day|requests_per_model_per_day|quota exceeded for metric/i.test(msg)) {
    return null;
  }
  const m = msg.match(/retry in\s+(\d+)h(?:(\d+)m)?(?:([\d.]+)s)?/i);
  if (m) {
    const h = Number(m[1]) || 0;
    const min = Number(m[2]) || 0;
    const sec = Number(m[3]) || 0;
    return Math.ceil((h * 3600 + min * 60 + sec) * 1000) + 60_000;
  }
  // Fallback: wait until next UTC day + 5 min
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5, 0));
  return Math.max(60_000, next.getTime() - now.getTime());
}

function writeQuotaPause(retryAfterMs, detail) {
  const until = new Date(Date.now() + retryAfterMs).toISOString();
  const payload = {
    pausedAt: new Date().toISOString(),
    resumeAfter: until,
    retryAfterMs,
    detail: String(detail).slice(0, 500),
  };
  mkdirSync(join(root, "book/translations"), { recursive: true });
  writeFileSync(join(root, "book/translations/quota-pause.json"), JSON.stringify(payload, null, 2));
  console.error(`QUOTA_PAUSE resumeAfter=${until} (~${Math.round(retryAfterMs / 3600000)}h)`);
}

async function translateChapter(ctx) {
  const srcPath = join(root, "book/translations/en/chapters", `${ctx.chapter.id}.md`);
  const source = readFileSync(srcPath, "utf8");
  const attempts = 4;
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (ctx.provider === "gemini") {
        return await translateChapterGemini({ ...ctx, source });
      }
      return await translateChapterDeepseek({ ...ctx, source });
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const dailyWait = parseDailyQuotaWaitMs(msg);
      if (dailyWait != null) {
        writeQuotaPause(dailyWait, msg);
        throw new QuotaExhaustedError(msg, dailyWait);
      }
      const retryable =
        /\b(429|503|502|UNAVAILABLE|rate|overload|timed out|timeout|Incomplete|Truncated|fetch failed|ECONNRESET|ENOTFOUND|socket)\b/i.test(
          msg,
        );
      if (!retryable || attempt === attempts) break;
      const wait = attempt * 12000;
      console.warn(`  … retry ${attempt}/${attempts} ${ctx.chapter.id} in ${wait / 1000}s (${msg.slice(0, 120)})`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  /** @type {Error | null} */
  let stopErr = null;
  const results = new Array(items.length);
  async function run() {
    while (i < items.length) {
      if (stopErr) return;
      const cur = i++;
      try {
        results[cur] = await worker(items[cur], cur);
      } catch (e) {
        if (e instanceof QuotaExhaustedError) {
          stopErr = e;
          return;
        }
        throw e;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  if (stopErr) throw stopErr;
  return results;
}

async function translateLocale(locale, opts) {
  if (!LOCALES[locale]) {
    console.error("Unknown locale", locale, "— expected", Object.keys(LOCALES).join("|"));
    process.exit(1);
  }
  const manifest = JSON.parse(
    readFileSync(join(root, "book/translations/en/chapters/manifest.json"), "utf8"),
  );
  const outDir = join(root, "book/translations", locale, "chapters");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  // Localized TOC stub (Word TOC body is stripped at EPUB build).
  writeFileSync(
    join(outDir, `${manifest.find((c) => c.skipTranslate)?.id || "000-toc"}.md`),
    `${LOCALES[locale].tocHeading}\n`,
  );

  const provider = opts.provider;
  const model = opts.model;
  const apiKey =
    provider === "gemini"
      ? process.env.GEMINI_API_KEY?.trim()
      : process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(provider === "gemini" ? "Missing GEMINI_API_KEY" : "Missing DEEPSEEK_API_KEY");
  }
  const baseURL = process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com";
  const systemPrompt = buildSystemPrompt(locale);

  let todo = manifest.filter((c) => !c.skipTranslate);
  if (opts.only) {
    todo = todo.filter((c) => c.id === opts.only || c.id.includes(opts.only));
    if (!todo.length) {
      console.error("No chapter matched --only", opts.only);
      process.exit(1);
    }
  }
  if (!opts.force) {
    todo = todo.filter((c) => !existsSync(join(outDir, `${c.id}.md`)));
  }

  console.log(
    `[${locale}] provider=${provider} model=${model} remaining=${todo.length}/${manifest.filter((c) => !c.skipTranslate).length} concurrency=${opts.concurrency}`,
  );

  let done = 0;
  let failed = 0;
  try {
    await mapPool(todo, opts.concurrency, async (chapter) => {
      const dest = join(outDir, `${chapter.id}.md`);
      const started = Date.now();
      try {
        // Empty pandoc leftover headings — copy as-is.
        if (chapter.words < 3) {
          const src = readFileSync(
            join(root, "book/translations/en/chapters", `${chapter.id}.md`),
            "utf8",
          );
          writeFileSync(dest, src);
          done += 1;
          console.log(`  ✓ ${chapter.id} (copy tiny, ${chapter.words}w) [${done}/${todo.length}]`);
          return;
        }
        const md = await translateChapter({
          provider,
          locale,
          chapter,
          systemPrompt,
          model,
          apiKey,
          baseURL,
        });
        if (md.trim().length < 40 && chapter.words > 80) {
          throw new Error(`Suspiciously short output (${md.length} chars)`);
        }
        writeFileSync(dest, md);
        done += 1;
        console.log(
          `  ✓ ${chapter.id} (${chapter.words}w → ${md.split(/\s+/).length}w, ${Math.round((Date.now() - started) / 1000)}s) [${done}/${todo.length}]`,
        );
      } catch (e) {
        if (e instanceof QuotaExhaustedError) throw e;
        failed += 1;
        console.error(`  ✗ ${chapter.id}:`, e instanceof Error ? e.message : e);
      }
    });
  } catch (e) {
    if (e instanceof QuotaExhaustedError) {
      console.log(`[${locale}] paused on daily quota after done=${done} failed=${failed}`);
      throw e;
    }
    throw e;
  }

  console.log(`[${locale}] done=${done} failed=${failed}`);
  return failed;
}

loadEnvLocal();
const args = parseArgs(process.argv.slice(2));
if (!args.locales.length) {
  console.error(
    "Usage: node scripts/book-translate.mjs --locale fr|it|es|pt|nl [--only id] [--concurrency N] [--force] [--provider gemini|deepseek] [--model id]\n       node scripts/book-translate.mjs --all --provider gemini",
  );
  process.exit(1);
}

ensureEnChapters();
args.provider = resolveProvider(args);
args.model = resolveModel(args.provider, args);

let totalFailed = 0;
try {
  for (const locale of args.locales) {
    totalFailed += await translateLocale(locale, args);
  }
} catch (e) {
  if (e instanceof QuotaExhaustedError) {
    process.exit(3);
  }
  throw e;
}
process.exit(totalFailed > 0 ? 2 : 0);
