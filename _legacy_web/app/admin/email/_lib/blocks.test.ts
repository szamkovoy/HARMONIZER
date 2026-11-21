import { describe, expect, it } from "vitest";

import { emailTextBlockHtml, sanitizeEmailBlocks, parseBlocksI18n, blocksToHtml, createEmptyBlock, type EmailBlock } from "./blocks";

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

  it("starts a new image at full column width", () => {
    const block = createEmptyBlock("image");
    expect(block.type).toBe("image");
    if (block.type === "image") expect(block.width).toBe("100%");
  });
});

describe('course email spacing through editing and saving',()=>{
 it.each(['<p></p>','<p><br></p>','<p>&nbsp;</p>'])('renders empty paragraphs %s in the editor and survives repeated saves',empty=>{
  const authored=`<p>Здравствуйте, {{name}}!</p>${empty}${empty}<p>Текст<br>Подпись</p>`;
  const block={...createEmptyBlock('text'),type:'text' as const,html:authored};
  const before=blocksToHtml([block]);
  const editable=emailTextBlockHtml(block);
  expect(editable.match(/height:1.55em/g)).toHaveLength(2);
  expect(editable).toContain('Текст<br>Подпись');
  let saved:EmailBlock[]=[{...block,html:editable}];
  for(let i=0;i<3;i++){
   saved=parseBlocksI18n(JSON.parse(JSON.stringify({ru:sanitizeEmailBlocks(saved)}))).ru;
   expect(blocksToHtml(saved)).toBe(before);
  }
 });
});
