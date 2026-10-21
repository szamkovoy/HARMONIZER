import { describe, expect, it } from "vitest";

import { classifyBookOwnershipHttp, decideBookOpen } from "./bookAccessDecision";

describe("classifyBookOwnershipHttp", () => {
  it("treats only an explicit 200 owned:false as no purchase", () => {
    expect(classifyBookOwnershipHttp(200, false)).toBe("absent");
    expect(classifyBookOwnershipHttp(200, undefined)).toBe("absent");
  });

  it("accepts an explicit owned:true", () => {
    expect(classifyBookOwnershipHttp(200, true)).toBe("owned");
  });

  it("does not turn auth or server failures into a missing purchase", () => {
    for (const status of [0, 401, 403, 500, 502, 503, 504]) {
      expect(classifyBookOwnershipHttp(status, false)).toBe("unavailable");
    }
  });
});

describe("decideBookOpen", () => {
  it("opens when the server confirms the purchase", () => {
    expect(decideBookOpen({ state: "owned" }, false)).toBe("open");
  });

  it("shows the cabinet gate only when the server says the book is not owned", () => {
    expect(decideBookOpen({ state: "absent" }, true)).toBe("gate");
  });

  it("keeps a previous reader in the book when the check cannot reach the server", () => {
    expect(decideBookOpen({ state: "unavailable" }, true)).toBe("open");
  });

  it("asks to retry instead of selling the book when the check fails and nothing is cached", () => {
    expect(decideBookOpen({ state: "unavailable" }, false)).toBe("retry");
  });
});
