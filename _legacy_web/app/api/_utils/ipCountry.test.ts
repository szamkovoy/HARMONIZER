import { describe, expect, it } from "vitest";

import {
  clientIpFromHeaders,
  countryFromVercelHeaders,
  isPublicIp,
  normalizeIsoCountryCode,
  resolveIpCountry,
} from "./ipCountry";

describe("normalizeIsoCountryCode", () => {
  it("accepts ISO alpha-2 and maps UK to GB", () => {
    expect(normalizeIsoCountryCode("ru")).toBe("RU");
    expect(normalizeIsoCountryCode(" US ")).toBe("US");
    expect(normalizeIsoCountryCode("UK")).toBe("GB");
  });

  it("drops reserved / unknown codes", () => {
    expect(normalizeIsoCountryCode("XX")).toBe("");
    expect(normalizeIsoCountryCode("T1")).toBe("");
    expect(normalizeIsoCountryCode("A1")).toBe("");
    expect(normalizeIsoCountryCode("EU")).toBe("");
    expect(normalizeIsoCountryCode("USA")).toBe("");
    expect(normalizeIsoCountryCode("")).toBe("");
  });
});

describe("isPublicIp / clientIpFromHeaders", () => {
  it("rejects loopback and RFC1918", () => {
    expect(isPublicIp("127.0.0.1")).toBe(false);
    expect(isPublicIp("10.0.0.1")).toBe(false);
    expect(isPublicIp("192.168.1.1")).toBe(false);
    expect(isPublicIp("172.16.0.1")).toBe(false);
    expect(isPublicIp("::1")).toBe(false);
    expect(isPublicIp("8.8.8.8")).toBe(true);
  });

  it("picks the first public hop in X-Forwarded-For", () => {
    const headers = new Headers({
      "x-forwarded-for": "127.0.0.1, 10.1.1.1, 203.0.113.10, 1.1.1.1",
    });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.10");
  });
});

describe("resolveIpCountry", () => {
  it("prefers Vercel header over IP lookup", async () => {
    const headers = new Headers({
      "x-vercel-ip-country": "de",
      "x-forwarded-for": "8.8.8.8",
    });
    const result = await resolveIpCountry(headers, async () => "US");
    expect(result).toEqual({ country: "DE", source: "vercel" });
  });

  it("falls back to lookup when Vercel country is unknown", async () => {
    const headers = new Headers({
      "x-vercel-ip-country": "XX",
      "x-forwarded-for": "8.8.8.8",
    });
    const result = await resolveIpCountry(headers, async (ip) => {
      expect(ip).toBe("8.8.8.8");
      return "NL";
    });
    expect(result).toEqual({ country: "NL", source: "ip_lookup" });
  });

  it("returns none when nothing is trusted", async () => {
    const headers = new Headers({ "x-forwarded-for": "192.168.0.5" });
    const result = await resolveIpCountry(headers, async () => "FR");
    expect(result).toEqual({ country: "", source: "none" });
  });
});

describe("countryFromVercelHeaders", () => {
  it("reads the production header", () => {
    expect(countryFromVercelHeaders(new Headers({ "x-vercel-ip-country": "fr" }))).toBe("FR");
  });
});

describe("resolveIpCountry behind the REG.RU proxy", () => {
  it("looks up the visitor IP forwarded by the proxy, ignoring the Vercel header", async () => {
    const headers = new Headers({
      "x-harmonizer-client-ip": "203.0.113.7",
      "x-vercel-ip-country": "RU",
      "x-forwarded-for": "31.31.196.134",
    });
    const result = await resolveIpCountry(headers, async (ip) => (ip === "203.0.113.7" ? "DE" : ""));
    expect(result).toEqual({ country: "DE", source: "proxy_client" });
  });

  it("returns unknown instead of the proxy's own RU geo when the proxy sent no client IP", async () => {
    const headers = new Headers({ "x-vercel-ip-country": "RU", "x-forwarded-for": "31.31.196.134" });
    const result = await resolveIpCountry(headers, async () => "RU");
    expect(result).toEqual({ country: "", source: "none" });
  });
});
