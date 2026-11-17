import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * `_legacy_web/public/hz-hosting/*` serves copies of the REG.RU hosting files
 * so the server can pull them with curl after a deploy. They must be byte-identical
 * to the canonical files in `deploy/` — this test fails the moment one side drifts.
 */
describe("hz hosting file copies", () => {
  it("public/hz-hosting/proxy.php matches deploy/reg-ru-harmonizer-proxy.php", () => {
    const canonical = readFileSync(
      path.join(webRoot, "../deploy/reg-ru-harmonizer-proxy.php"),
      "utf8",
    );
    const copy = readFileSync(path.join(webRoot, "public/hz-hosting/proxy.php"), "utf8");
    expect(copy).toBe(canonical);
  });

  it("public/hz-hosting/htaccess matches deploy/hz/.htaccess", () => {
    const canonical = readFileSync(path.join(webRoot, "../deploy/hz/.htaccess"), "utf8");
    const copy = readFileSync(path.join(webRoot, "public/hz-hosting/htaccess"), "utf8");
    expect(copy).toBe(canonical);
  });
});
