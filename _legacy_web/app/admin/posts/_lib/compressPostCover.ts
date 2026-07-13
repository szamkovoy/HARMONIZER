/**
 * Client-side cover compress before upload to `post-covers`.
 * Keeps aspect ratio, caps long edge, outputs JPEG (~mobile-friendly size).
 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export async function compressPostCoverFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      if (scale >= 1 && file.size <= 450_000 && file.type === "image/jpeg") {
        return file;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((value) => resolve(value), "image/jpeg", JPEG_QUALITY);
      });
      if (!blob) return file;

      const base = file.name.replace(/\.[^.]+$/, "") || "cover";
      return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
    } finally {
      bitmap.close();
    }
  } catch {
    // createImageBitmap / canvas can fail on odd HEIC/CMYK files — upload original.
    return file;
  }
}
