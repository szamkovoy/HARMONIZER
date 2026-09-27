export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  const head = bytes.length >= 6 ? bytes.toString("ascii", 0, 6) : "";
  if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function boundaryOf(body: Buffer, contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const fromHeader = (match?.[1] || match?.[2] || "").trim();
  if (fromHeader) return fromHeader;
  if (body.length < 4 || body[0] !== 0x2d || body[1] !== 0x2d) return null;
  const nl = body.indexOf(0x0a);
  if (nl < 3) return null;
  const lineEnd = body[nl - 1] === 0x0d ? nl - 1 : nl;
  const line = body.subarray(2, lineEnd).toString("latin1").trim();
  return line || null;
}

function partImage(part: Buffer): { bytes: Buffer; mime: string } | null {
  const sepCrlf = part.indexOf(Buffer.from("\r\n\r\n"));
  const sepLf = sepCrlf >= 0 ? -1 : part.indexOf(Buffer.from("\n\n"));
  const sep = sepCrlf >= 0 ? sepCrlf : sepLf;
  if (sep < 0) return null;
  const headerBytes = part.subarray(0, sep);
  const headers = headerBytes.toString("latin1");
  const lower = headers.toLowerCase();
  if (!lower.includes('name="file"') && !lower.includes("filename=")) return null;
  const bytes = part.subarray(sep + (sepCrlf >= 0 ? 4 : 2));
  if (bytes.length === 0) return null;
  const mimeMatch = /content-type:\s*([^\r\n;]+)/i.exec(headers);
  const declared = mimeMatch?.[1]?.trim().toLowerCase() || "";
  const mime = declared.startsWith("image/") ? declared : sniffImageMime(bytes);
  if (!mime) return null;
  return { bytes, mime };
}

/**
 * Read an admin image upload. Raw `image/*` is the normal path.
 * Multipart is accepted too: the yoga proxy drops the boundary parameter,
 * but the body still starts with `--boundary`.
 */
export function imageFromUploadBody(
  body: Buffer,
  contentType: string,
): { bytes: Buffer; mime: string } | null {
  const type = contentType.toLowerCase();
  if (!type.includes("multipart/form-data")) {
    if (body.length === 0) return null;
    const headerMime = type.split(";")[0]?.trim() || "";
    const mime = headerMime.startsWith("image/") ? headerMime : sniffImageMime(body);
    return mime ? { bytes: body, mime } : null;
  }

  const boundary = boundaryOf(body, contentType);
  if (!boundary) return sniffImageMime(body) ? { bytes: body, mime: sniffImageMime(body) as string } : null;
  const delim = Buffer.from(`--${boundary}`);
  let search = 0;
  while (search < body.length) {
    const at = body.indexOf(delim, search);
    if (at < 0) break;
    let cursor = at + delim.length;
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) break;
    if (body[cursor] === 0x0d) cursor += 1;
    if (body[cursor] === 0x0a) cursor += 1;
    const next = body.indexOf(delim, cursor);
    if (next < 0) break;
    let part = body.subarray(cursor, next);
    if (part.length >= 2 && part[part.length - 2] === 0x0d && part[part.length - 1] === 0x0a) {
      part = part.subarray(0, part.length - 2);
    } else if (part.length >= 1 && part[part.length - 1] === 0x0a) {
      part = part.subarray(0, part.length - 1);
      if (part.length >= 1 && part[part.length - 1] === 0x0d) part = part.subarray(0, part.length - 1);
    }
    const image = partImage(part);
    if (image) return image;
    search = next;
  }
  return null;
}
