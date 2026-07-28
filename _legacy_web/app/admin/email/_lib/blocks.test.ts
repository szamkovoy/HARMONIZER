import { describe, expect, it } from "vitest";

import { blocksToHtml, type EmailBlock } from "./blocks";

describe("blocksToHtml image dimensions", () => {
  it("emits integer width/height so clients can reserve space", () => {
    const blocks: EmailBlock[] = [
      {
        id: "i1",
        type: "image",
        src: "https://example.com/logo.png",
        alt: "Logo",
        width: "240px",
        naturalWidth: 480,
        naturalHeight: 240,
        align: "center",
        marginTop: 0,
        marginBottom: 12,
      },
    ];
    const html = blocksToHtml(blocks);
    expect(html).toContain('width="240"');
    expect(html).toContain('height="120"');
    expect(html).toContain("height:auto");
    expect(html).toContain("display:inline-block");
    expect(html).toContain("text-align:center");
    expect(html).not.toContain('width="240px"');
  });
});
