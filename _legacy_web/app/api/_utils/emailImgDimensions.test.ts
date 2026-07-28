import { describe, expect, it, vi } from "vitest";

vi.mock("sharp", () => {
  return {
    default: () => ({
      metadata: async () => ({ width: 800, height: 400 }),
    }),
  };
});

describe("ensureImgDimensionsInHtml", () => {
  it("does not treat max-width:100% as width:100%", async () => {
    const { ensureImgDimensionsInHtml } = await import("./emailImgDimensions");
    const input =
      '<img src="https://example.com/a.png" alt="x" width="240px" style="max-width:100%;height:auto;display:inline-block;border:0;" />';

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );

    const out = await ensureImgDimensionsInHtml(input);
    expect(out).toContain('width="240"');
    expect(out).toContain("width:240px");
    expect(out).toContain("max-width:100%");
    expect(out).toContain("display:inline-block");
    expect(out).not.toMatch(/(?:^|;)\s*width\s*:\s*100%/i);
  });
});
