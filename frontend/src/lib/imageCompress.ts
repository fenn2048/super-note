/**
 * 聊天 / 说说发图：上传前在浏览器里压一版。
 * 参数与 backend/src/services/imageCompress.ts 对齐。
 * 失败一律返回原 File，发图不能因此失败。
 */

export const IMAGE_COMPRESS = {
  MAX_EDGE: 2560,
  /** Canvas toBlob 用 0–1 */
  WEBP_QUALITY: 0.8,
  JPEG_QUALITY: 0.82,
  SKIP_BYTES: 400 * 1024,
} as const;

const RASTER_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/bmp",
]);

export function isCompressibleImage(mime: string): boolean {
  const m = (mime || "").toLowerCase();
  if (m === "image/gif") return false;
  return RASTER_MIMES.has(m);
}

export function scaledSize(
  width: number,
  height: number,
  maxEdge: number = IMAGE_COMPRESS.MAX_EDGE,
): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const long = Math.max(w, h);
  if (long <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

export function replaceFilenameExt(name: string, ext: string): string {
  const raw = (name || "image").trim() || "image";
  const base = raw.replace(/\.[^.]+$/, "") || "image";
  return `${base}.${ext}`;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

let webpSupport: boolean | null = null;

async function canEncodeWebp(): Promise<boolean> {
  if (webpSupport != null) return webpSupport;
  if (typeof document === "undefined") {
    webpSupport = false;
    return false;
  }
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const blob = await canvasToBlob(c, "image/webp", 0.8);
    webpSupport = !!blob && blob.type === "image/webp";
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

/** 测试用：重置 WebP 探测缓存 */
export function resetWebpSupportCache(): void {
  webpSupport = null;
}

export async function compressImageForUpload(file: File): Promise<File> {
  try {
    if (!file || !isCompressibleImage(file.type)) return file;
    // 已经很小的图不解码，避免截图文字发糊
    if (file.size <= IMAGE_COMPRESS.SKIP_BYTES) return file;
    if (typeof createImageBitmap !== "function") return file;

    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const out = scaledSize(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = out.width;
      canvas.height = out.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, out.width, out.height);

      const useWebp = await canEncodeWebp();
      // PNG 透明通道：没有 WebP 时不要降成 JPEG（会垫底变糊/丢 alpha）
      if (!useWebp && file.type === "image/png") return file;

      const type = useWebp ? "image/webp" : "image/jpeg";
      const quality = useWebp ? IMAGE_COMPRESS.WEBP_QUALITY : IMAGE_COMPRESS.JPEG_QUALITY;
      const blob = await canvasToBlob(canvas, type, quality);
      if (!blob || blob.size <= 0 || blob.size >= file.size) return file;

      const ext = useWebp ? "webp" : "jpg";
      return new File([blob], replaceFilenameExt(file.name, ext), {
        type,
        lastModified: file.lastModified,
      });
    } finally {
      bitmap.close?.();
    }
  } catch {
    return file;
  }
}
