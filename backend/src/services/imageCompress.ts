/**
 * 聊天 / 说说上传落盘前的光栅图压缩。
 * 参数与 frontend/src/lib/imageCompress.ts 对齐。
 * sharp 不可用或处理失败时返回原 buffer，上传不能因此失败。
 */
let sharp: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  sharp = require("sharp");
} catch (err) {
  console.warn("[imageCompress] sharp 未安装或加载失败，上传将保存原图。", err);
}

export const IMAGE_COMPRESS = {
  MAX_EDGE: 2560,
  WEBP_QUALITY: 80,
  SKIP_BYTES: 400 * 1024,
} as const;

const RASTER_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/bmp",
]);

export function isCompressibleImageMime(mime: string): boolean {
  const m = (mime || "").toLowerCase();
  if (m === "image/gif") return false;
  return RASTER_MIMES.has(m);
}

function extForMime(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/bmp") return "bmp";
  return "bin";
}

export function replaceFilenameExt(name: string, ext: string): string {
  const raw = ((name || "image").trim() || "image").slice(0, 255);
  const base = raw.replace(/\.[^.]+$/, "") || "image";
  return `${base}.${ext}`.slice(0, 255);
}

export async function compressRasterImage(
  buffer: Buffer,
  mime: string,
): Promise<{ buffer: Buffer; mime: string; ext: string }> {
  const origMime = (mime || "").toLowerCase() || "application/octet-stream";
  const fallback = { buffer, mime: origMime, ext: extForMime(origMime) };

  if (!isCompressibleImageMime(origMime)) return fallback;
  if (!sharp) return fallback;

  try {
    const img = sharp(buffer, {
      limitInputPixels: 268_402_689,
    });
    const meta = await img.metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    const long = Math.max(w, h);

    if (long > 0 && long <= IMAGE_COMPRESS.MAX_EDGE && buffer.length <= IMAGE_COMPRESS.SKIP_BYTES) {
      return fallback;
    }
    if (long === 0 && buffer.length <= IMAGE_COMPRESS.SKIP_BYTES) {
      return fallback;
    }

    let pipeline = img.rotate();
    if (long > IMAGE_COMPRESS.MAX_EDGE) {
      pipeline = pipeline.resize({
        width: IMAGE_COMPRESS.MAX_EDGE,
        height: IMAGE_COMPRESS.MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const out: Buffer = await pipeline
      .webp({
        quality: IMAGE_COMPRESS.WEBP_QUALITY,
        effort: 4,
      })
      .toBuffer();

    if (!out || out.length === 0 || out.length >= buffer.length) return fallback;
    return { buffer: out, mime: "image/webp", ext: "webp" };
  } catch (err) {
    console.warn("[imageCompress] 压缩失败，保留原图:", err);
    return fallback;
  }
}
