import { describe, expect, it } from "vitest";
import {
  computeCSI,
  computeETV,
  detectInsightMoment,
  detectTTMStage,
  estimateEmotionalValence,
  isReadyForPractice,
} from "./insightDetection";

describe("computeCSI", () => {
  it("returns low CSI for past-tense self-focused message", () => {
    const text = "я был очень расстроен. меня обидели. я плакал.";
    expect(computeCSI(text, "ru")).toBeLessThan(0.3);
  });

  it("returns high CSI for future-oriented cognitive message", () => {
    const text = "я понимаю, что нужно сделать. теперь я знаю, как это связано. буду пробовать с этого момента.";
    expect(computeCSI(text, "ru")).toBeGreaterThan(0.5);
  });

  it("returns 0 for empty or very short message", () => {
    expect(computeCSI("", "ru")).toBe(0);
    expect(computeCSI("ага", "ru")).toBe(0);
  });

  it("works for English", () => {
    const text = "i understand now. i will try this from now on. it's because of that pattern.";
    expect(computeCSI(text, "en")).toBeGreaterThan(0.4);
  });
});

describe("detectInsightMoment", () => {
  it("detects insight when CSI grew from low to high", () => {
    const result = detectInsightMoment([0.2, 0.3, 0.6]);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.4);
  });

  it("does not detect when CSI is consistently low", () => {
    const result = detectInsightMoment([0.1, 0.2, 0.15]);
    expect(result.detected).toBe(false);
    expect(result.reason).toBe("csi_too_low");
  });

  it("does not detect when CSI is high but flat", () => {
    const result = detectInsightMoment([0.5, 0.55, 0.5]);
    expect(result.detected).toBe(false);
    expect(result.reason).toBe("no_growth");
  });
});

describe("emotional valence and ETV", () => {
  it("estimates positive and negative valence", () => {
    expect(estimateEmotionalValence("мне хорошо и спокойно", "ru")).toBeGreaterThan(0);
    expect(estimateEmotionalValence("мне тревожно и тяжело", "ru")).toBeLessThan(0);
  });

  it("returns 0 for stable valence", () => {
    expect(computeETV([0.5, 0.5, 0.5, 0.5])).toBeLessThan(0.1);
  });

  it("returns high for swinging valence", () => {
    expect(computeETV([0.8, -0.7, 0.6, -0.8])).toBeGreaterThan(0.6);
  });
});

describe("detectTTMStage", () => {
  it("detects preconcept resistance", () => {
    const result = detectTTMStage(["у меня нет проблем", "это всё из-за начальника"], "ru");
    expect(result.stage).toBe("preconcept");
  });

  it("detects concept ambivalence", () => {
    const result = detectTTMStage(["может быть, что-то надо менять", "не уверена, надо ли"], "ru");
    expect(result.stage).toBe("concept");
  });

  it("detects preparation readiness", () => {
    const result = detectTTMStage(["хочу попробовать", "что мне сделать прямо сейчас"], "ru");
    expect(result.stage).toBe("preparation");
  });
});

describe("isReadyForPractice", () => {
  it("blocks practice in preconcept and concept", () => {
    expect(isReadyForPractice("preconcept").ready).toBe(false);
    expect(isReadyForPractice("concept").ready).toBe(false);
  });

  it("allows practice in preparation+", () => {
    expect(isReadyForPractice("preparation").ready).toBe(true);
    expect(isReadyForPractice("action").ready).toBe(true);
    expect(isReadyForPractice("maintenance").ready).toBe(true);
  });
});
