import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { normalizeStorePermissions } = require("./with-android-location-permission-merge.js") as {
  normalizeStorePermissions: (manifest: unknown) => {
    manifest: {
      "uses-permission-sdk-23": Array<{ $: Record<string, string> }>;
      "uses-permission": Array<{ $: Record<string, string> }>;
    };
  };
};

function baseManifest() {
  return {
    manifest: {
      $: {
        "xmlns:android": "http://schemas.android.com/apk/res/android",
      },
      "uses-permission-sdk-23": [
        {
          $: {
            "android:name": "android.permission.ACCESS_COARSE_LOCATION",
            "android:maxSdkVersion": "30",
          },
        },
        {
          $: {
            "android:name": "android.permission.ACCESS_FINE_LOCATION",
            "android:maxSdkVersion": "30",
          },
        },
      ],
      "uses-permission": [
        { $: { "android:name": "android.permission.ACCESS_COARSE_LOCATION" } },
        { $: { "android:name": "android.permission.ACCESS_FINE_LOCATION" } },
        { $: { "android:name": "android.permission.BLUETOOTH" } },
        { $: { "android:name": "android.permission.BLUETOOTH_ADMIN" } },
        { $: { "android:name": "android.permission.BLUETOOTH_SCAN" } },
        { $: { "android:name": "android.permission.READ_EXTERNAL_STORAGE" } },
        { $: { "android:name": "android.permission.WRITE_EXTERNAL_STORAGE" } },
        { $: { "android:name": "android.permission.CAMERA" } },
      ],
    },
  };
}

describe("normalizeStorePermissions", () => {
  it("removes capped sdk-23 location and keeps a single replace location entry", () => {
    const result = normalizeStorePermissions(baseManifest());
    const sdk23 = result.manifest["uses-permission-sdk-23"];
    expect(sdk23.every((item) => item.$["tools:node"] === "remove")).toBe(true);

    const location = result.manifest["uses-permission"].filter((item) =>
      String(item.$["android:name"]).includes("LOCATION"),
    );
    expect(location).toHaveLength(2);
    expect(location.every((item) => item.$["tools:node"] === "replace")).toBe(true);
    expect(location.every((item) => !item.$["android:maxSdkVersion"])).toBe(true);
  });

  it("caps legacy bluetooth/storage and marks BLUETOOTH_SCAN neverForLocation", () => {
    const result = normalizeStorePermissions(baseManifest());
    const byName = Object.fromEntries(
      result.manifest["uses-permission"].map((item) => [item.$["android:name"], item.$]),
    );
    expect(byName["android.permission.BLUETOOTH"]["android:maxSdkVersion"]).toBe("30");
    expect(byName["android.permission.BLUETOOTH_ADMIN"]["android:maxSdkVersion"]).toBe("30");
    expect(byName["android.permission.READ_EXTERNAL_STORAGE"]["android:maxSdkVersion"]).toBe("32");
    expect(byName["android.permission.WRITE_EXTERNAL_STORAGE"]["android:maxSdkVersion"]).toBe("32");
    expect(byName["android.permission.BLUETOOTH_SCAN"]["android:usesPermissionFlags"]).toBe(
      "neverForLocation",
    );
    expect(byName["android.permission.CAMERA"]).toBeTruthy();
  });
});
