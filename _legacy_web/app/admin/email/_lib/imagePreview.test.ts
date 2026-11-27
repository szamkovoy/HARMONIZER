import { describe, expect, it, vi } from "vitest";

import { blocksToHtml, loadImageNaturalSize, type EmailBlock } from "./blocks";
import { emailImagePreviewHtml, emailImagePreviewSrc } from "./imagePreview";

const path = "/email-cdn/email-assets/campaigns/1795790208334-dlf3yu.jpg";
const publicUrl = `https://harmonizer.zamkovoi.yoga${path}`;

describe("admin email image previews", () => {
  it("loads persisted public URLs and raw Blob URLs through the current admin origin", () => {
    expect(emailImagePreviewSrc(publicUrl)).toBe(path);
    expect(emailImagePreviewSrc(`https://harmonizer-ten.vercel.app${path}?v=1`)).toBe(`${path}?v=1`);
    expect(emailImagePreviewSrc("https://q4x3cjvcrju8s2s0.public.blob.vercel-storage.com/email-assets/header.gif"))
      .toBe("/email-cdn/email-assets/header.gif");
  });

  it("keeps external images, local uploads and unrelated URLs unchanged", () => {
    for (const src of [
      "https://i.ytimg.com/vi/example/hqdefault.jpg",
      "https://example.com/email-cdn/image.jpg",
      "https://harmonizer.zamkovoi.yoga.example.com/email-cdn/image.jpg",
      "https://harmonizer.zamkovoi.yoga/api/email/asset?path=old.jpg",
      "blob:https://harmonizer-ten.vercel.app/local-upload",
      "data:image/png;base64,AAAA",
      path,
      "",
    ]) expect(emailImagePreviewSrc(src)).toBe(src);
  });

  it("rewrites iframe and legacy HTML images without changing links, text or attributes", () => {
    const html = `<a href="${publicUrl}">${publicUrl}<IMG alt="keep src='${publicUrl}' >" src='${publicUrl}' width="1000" height="558"></a>`;
    expect(emailImagePreviewHtml(html))
      .toBe(`<a href="${publicUrl}">${publicUrl}<IMG alt="keep src='${publicUrl}' >" src='${path}' width="1000" height="558"></a>`);
  });

  it("keeps public URLs and intrinsic dimensions in saved/send HTML after repeated previews", () => {
    const blocks: EmailBlock[] = [{ id: "cover", type: "image", src: publicUrl, alt: "Посмотрите видео", naturalWidth: 1000, naturalHeight: 558 }];
    const html = blocksToHtml(blocks);
    const preview = emailImagePreviewHtml(html);
    expect(preview).toContain(`src="${path}"`);
    expect(emailImagePreviewHtml(preview)).toBe(preview);
    expect(blocks[0]).toMatchObject({ src: publicUrl, naturalWidth: 1000, naturalHeight: 558 });
    expect(blocksToHtml(blocks)).toBe(html);
    expect(html).toContain(`src="${publicUrl}"`);
  });

  it("uses the same preview route when probing dimensions before saving", async () => {
    let requestedSrc = "";
    vi.stubGlobal("Image", class {
      naturalWidth = 1000;
      naturalHeight = 558;
      onload?: () => void;
      set src(value: string) {
        requestedSrc = value;
        this.onload?.();
      }
    });
    try {
      await expect(loadImageNaturalSize(publicUrl)).resolves.toEqual({ width: 1000, height: 558 });
      expect(requestedSrc).toBe(path);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
