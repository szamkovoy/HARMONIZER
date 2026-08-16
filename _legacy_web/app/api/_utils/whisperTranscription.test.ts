import { afterEach, describe, expect, it, vi } from "vitest";
import { resetWhisperCircuitMemoryForTests } from "./whisperCircuitBreaker";
import { confidenceFromSegments, transcribeWhisperAudio } from "./whisperTranscription";

const originalGroqKey = process.env.GROQ_API_KEY;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  process.env.GROQ_API_KEY = originalGroqKey;
  process.env.OPENAI_API_KEY = originalOpenAiKey;
  resetWhisperCircuitMemoryForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("confidenceFromSegments", () => {
  it("averages segment probabilities from avg_logprob", () => {
    expect(confidenceFromSegments([{ avg_logprob: 0 }, { avg_logprob: Math.log(0.5) }])).toBeCloseTo(0.75);
  });

  it("returns undefined without verbose segments", () => {
    expect(confidenceFromSegments(undefined)).toBeUndefined();
  });
});

describe("transcribeWhisperAudio", () => {
  it("passes language, prompt, temperature and verbose_json to Groq", async () => {
    process.env.GROQ_API_KEY = "test-key";
    process.env.OPENAI_API_KEY = "";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          text: "почему планета дня — Солнце, а чакра — Сахасрара",
          language: "ru",
          duration: 4.2,
          segments: [{ avg_logprob: Math.log(0.8) }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await transcribeWhisperAudio({
      audio: { mimeType: "audio/mp4", base64: Buffer.from("audio").toString("base64") },
      language: "ru-RU",
    });

    expect(result).toMatchObject({
      text: "почему планета дня — Солнце, а чакра — Сахасрара",
      language: "ru",
      durationSeconds: 4.2,
      provider: "groq",
    });
    expect(result.confidence).toBeCloseTo(0.8);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("api.groq.com");
    const form = fetchSpy.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("language")).toBe("ru");
    expect(form.get("temperature")).toBe("0");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(String(form.get("prompt"))).toContain("Сахасрара");
  });

  it("falls back to OpenAI on Groq 429 with retry-after", async () => {
    process.env.GROQ_API_KEY = "groq-key";
    process.env.OPENAI_API_KEY = "openai-key";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("api.groq.com")) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Rate limit reached. Please try again in 6m 11.52s.",
              code: "rate_limit_exceeded",
            },
          }),
          {
            status: 429,
            headers: { "retry-after": "2", "content-type": "application/json" },
          },
        );
      }
      return new Response(
        JSON.stringify({ text: "fallback ok", language: "ru", duration: 1 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await transcribeWhisperAudio({
      audio: { mimeType: "audio/m4a", base64: Buffer.from("x").toString("base64") },
      language: "ru",
    });

    expect(result.provider).toBe("openai");
    expect(result.text).toBe("fallback ok");
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("api.groq.com"))).toBe(true);
    expect(urls.some((u) => u.includes("api.openai.com"))).toBe(true);
  });

  it("skips Groq while circuit is open and uses OpenAI directly", async () => {
    process.env.GROQ_API_KEY = "groq-key";
    process.env.OPENAI_API_KEY = "openai-key";
    resetWhisperCircuitMemoryForTests({
      groqBlockedUntil: Date.now() + 60_000,
      consecutiveFallbackCount: 1,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ text: "direct openai", language: "en" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await transcribeWhisperAudio({
      audio: { mimeType: "audio/m4a", base64: Buffer.from("x").toString("base64") },
    });

    expect(result.provider).toBe("openai");
    expect(result.text).toBe("direct openai");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("api.openai.com");
  });

  it("does not fall back on Groq 400", async () => {
    process.env.GROQ_API_KEY = "groq-key";
    process.env.OPENAI_API_KEY = "openai-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "bad file" } }), { status: 400 }),
    );

    await expect(
      transcribeWhisperAudio({
        audio: { mimeType: "audio/m4a", base64: Buffer.from("x").toString("base64") },
      }),
    ).rejects.toThrow(/400/);
  });
});
