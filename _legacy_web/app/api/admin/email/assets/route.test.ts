import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  storageFrom: vi.fn(),
  upload: vi.fn(),
  getPublicUrl: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("../../../_utils/supabase", () => ({
  requireAdmin: mocks.requireAdmin,
  createServiceSupabase: () => ({
    storage: { from: mocks.storageFrom },
    from: mocks.from,
  }),
  json: (value: unknown, init?: ResponseInit) => Response.json(value, init),
  errorResponse: (error: unknown) => error instanceof Response
    ? error
    : Response.json({ error: "Upload failed" }, { status: 500 }),
}));

import { POST } from "./route";

const storageBase = "https://test-project.supabase.co/storage/v1/object/public/email-assets/";
// A transport fixture above the former 56 KB threshold; bytes must stay unchanged.
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(137_821, 0x37), Buffer.from([0xff, 0xd9])]);

function request(bytes: Buffer = jpeg, contentType = "image/jpeg"): Request {
  return new Request("https://admin.example/api/admin/email/assets", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(bytes),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue("admin");
  mocks.storageFrom.mockReturnValue({ upload: mocks.upload, getPublicUrl: mocks.getPublicUrl });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.getPublicUrl.mockImplementation((path: string) => ({ data: { publicUrl: storageBase + path } }));
  mocks.from.mockReturnValue({ insert: mocks.insert });
  mocks.insert.mockResolvedValue({ error: null });
});

describe("email asset upload", () => {
  it("stores the original bytes and returns a direct public Storage URL", async () => {
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.path).toMatch(/^campaigns\/\d+-[a-f0-9-]+\.jpg$/);
    expect(body.public_url).toBe(storageBase + body.path);
    expect(mocks.storageFrom).toHaveBeenCalledWith("email-assets");
    expect(mocks.upload).toHaveBeenCalledWith(body.path, jpeg, {
      contentType: "image/jpeg", cacheControl: "31536000", upsert: false,
    });
    expect(mocks.from).toHaveBeenCalledWith("email_assets");
    expect(mocks.insert).toHaveBeenCalledWith({ path: body.path, public_url: body.public_url });
    expect(body.public_url).not.toContain("email-cdn");
    expect(body.public_url).not.toContain("/api/email/asset");
  });

  it("keeps accepting a multipart upload whose boundary header was stripped", async () => {
    const boundary = "----LetterImageBoundary";
    const multipart = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cover.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      jpeg,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    expect((await POST(request(multipart, "multipart/form-data"))).status).toBe(200);
    expect(mocks.upload.mock.calls[0][1]).toEqual(jpeg);
  });

  it("preserves PNG, WebP and animated GIF bytes and content types", async () => {
    for (const [mime, ext] of [["image/png", "png"], ["image/webp", "webp"], ["image/gif", "gif"]]) {
      const bytes = Buffer.from(`original ${mime} bytes`);
      const response = await POST(request(bytes, mime));
      expect(response.status).toBe(200);
      const [path, storedBytes, options] = mocks.upload.mock.calls.at(-1)!;
      expect(path).toMatch(new RegExp(`\\.${ext}$`));
      expect(storedBytes).toEqual(bytes);
      expect(options.contentType).toBe(mime);
    }
  });

  it("does not return or register an asset when Storage fails", async () => {
    mocks.upload.mockResolvedValue({ error: new Error("Storage unavailable") });
    expect((await POST(request())).status).toBe(500);
    expect(mocks.getPublicUrl).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("does not report success if asset registration fails", async () => {
    mocks.insert.mockResolvedValue({ error: new Error("Database unavailable") });
    expect((await POST(request())).status).toBe(500);
  });

  it("requires an administrator before writing to Storage", async () => {
    mocks.requireAdmin.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
    expect((await POST(request())).status).toBe(401);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects oversized files before upload", async () => {
    expect((await POST(request(Buffer.alloc(3 * 1024 * 1024 + 1)))).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects image types unsupported by the existing bucket", async () => {
    expect((await POST(request(Buffer.from("<svg/>"), "image/svg+xml"))).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
