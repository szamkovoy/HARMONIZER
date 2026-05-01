import { afterEach, describe, expect, it, vi } from "vitest";
import { confidenceFromSegments, transcribeGroqAudio } from "./whisperTranscription";

const originalGroqKey = process.env.GROQ_API_KEY;

afterEach(() => {
  process.env.GROQ_API_KEY = originalGroqKey;
  vi.restoreAllMocks();
});

describe("confidenceFromSegments", () => {
  it("averages segment probabilities from avg_logprob", () => {
    expect(confidenceFromSegments([{ avg_logprob: 0 }, { avg_logprob: Math.log(0.5) }])).toBeCloseTo(0.75);
  });

  it("returns undefined without verbose segments", () => {
    expect(confidenceFromSegments(undefined)).toBeUndefined();
  });
});

describe("transcribeGroqAudio", () => {
  it("passes language, prompt, temperature and verbose_json to Groq", async () => {
    process.env.GROQ_API_KEY = "test-key";
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

    const result = await transcribeGroqAudio({
      audio: { mimeType: "audio/mp4", base64: Buffer.from("audio").toString("base64") },
      language: "ru-RU",
    });

    expect(result).toMatchObject({
      text: "почему планета дня — Солнце, а чакра — Сахасрара",
      language: "ru",
      durationSeconds: 4.2,
    });
    expect(result.confidence).toBeCloseTo(0.8);
    const form = fetchSpy.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("language")).toBe("ru");
    expect(form.get("temperature")).toBe("0");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(String(form.get("prompt"))).toContain("Сахасрара");
  });
});
