import { describe, expect, it } from "vitest";

import { imageFromUploadBody } from "./emailImageUpload";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0xd9]);

function multipart(boundary: string): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
    jpeg,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

describe("imageFromUploadBody", () => {
  it("reads a raw jpeg", () => {
    const out = imageFromUploadBody(jpeg, "image/jpeg");
    expect(out?.mime).toBe("image/jpeg");
    expect(out?.bytes).toEqual(jpeg);
  });

  it("reads multipart when the proxy dropped the boundary parameter", () => {
    const boundary = "----WebKitFormBoundaryabc";
    const out = imageFromUploadBody(multipart(boundary), "multipart/form-data");
    expect(out?.mime).toBe("image/jpeg");
    expect(out?.bytes).toEqual(jpeg);
  });

  it("reads multipart when the header still has the boundary", () => {
    const boundary = "----WebKitFormBoundaryxyz";
    const out = imageFromUploadBody(
      multipart(boundary),
      `multipart/form-data; boundary=${boundary}`,
    );
    expect(out?.bytes).toEqual(jpeg);
  });

  it("returns null for an empty body", () => {
    expect(imageFromUploadBody(Buffer.alloc(0), "multipart/form-data")).toBeNull();
  });
});
