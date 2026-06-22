import { describe, expect, it } from "vitest";

import { AppUserError, resolveUserFacingAlert, resolveUserFacingMessage, wrapConnectivityFailure } from "./userFacingErrors";
import { withTransientNetworkRetry } from "./withTransientNetworkRetry";

describe("userFacingErrors", () => {
  it("maps network failure to localized copy", () => {
    const copy = resolveUserFacingAlert(new Error("Network request failed"), "ru");
    expect(copy.title).toBe("Не удалось связаться с сервером");
    expect(copy.retryable).toBe(true);
  });

  it("resolveUserFacingMessage returns localized body without debug prefix", () => {
    const message = resolveUserFacingMessage(
      wrapConnectivityFailure(new TypeError("Network request failed"), "profile-reports"),
      "ru",
    );
    expect(message).toContain("интернет");
    expect(message).not.toContain("[profile-reports]");
  });

  it("maps legacy communicator URL message to network", () => {
    const copy = resolveUserFacingAlert(
      new Error("Communicator network error for https://harmonizer-ten.vercel.app/api/dialog: Network request failed"),
      "en",
    );
    expect(copy.title).toBe("Could not reach the server");
    expect(copy.message).toContain("Wi‑Fi");
  });

  it("wrapConnectivityFailure produces AppUserError", () => {
    const err = wrapConnectivityFailure(new TypeError("Network request failed"), "assistant");
    expect(err).toBeInstanceOf(AppUserError);
    expect((err as AppUserError).userFacingKind).toBe("network");
  });

  it("treats AbortError as retryable timeout copy", () => {
    const abortError = Object.assign(new Error("Aborted"), { name: "AbortError" });
    const copy = resolveUserFacingAlert(abortError, "ru");
    expect(copy.title).toBe("Ответ занимает слишком много времени");
    expect(copy.retryable).toBe(true);
  });

  it("wrapConnectivityFailure maps AbortError to timeout AppUserError", () => {
    const err = wrapConnectivityFailure(Object.assign(new Error("Aborted"), { name: "AbortError" }), "communicator");
    expect(err).toBeInstanceOf(AppUserError);
    expect((err as AppUserError).userFacingKind).toBe("timeout");
  });
});

describe("withTransientNetworkRetry", () => {
  it("retries transient failures then succeeds", async () => {
    let calls = 0;
    const result = await withTransientNetworkRetry(async () => {
      calls += 1;
      if (calls < 2) throw new TypeError("Network request failed");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("retries wrapped AppUserError network failures", async () => {
    let calls = 0;
    const result = await withTransientNetworkRetry(async () => {
      calls += 1;
      if (calls < 2) {
        throw wrapConnectivityFailure(new TypeError("Network request failed"), "profile-reports");
      }
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });
});
