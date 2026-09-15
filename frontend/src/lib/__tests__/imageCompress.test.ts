import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_COMPRESS,
  compressImageForUpload,
  isCompressibleImage,
  replaceFilenameExt,
  resetWebpSupportCache,
  scaledSize,
} from "@/lib/imageCompress";

afterEach(() => {
  resetWebpSupportCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isCompressibleImage", () => {
  it("accepts jpeg/png/webp/bmp", () => {
    expect(isCompressibleImage("image/jpeg")).toBe(true);
    expect(isCompressibleImage("image/png")).toBe(true);
    expect(isCompressibleImage("image/webp")).toBe(true);
    expect(isCompressibleImage("image/bmp")).toBe(true);
  });

  it("skips gif, video, audio, empty", () => {
    expect(isCompressibleImage("image/gif")).toBe(false);
    expect(isCompressibleImage("audio/webm")).toBe(false);
    expect(isCompressibleImage("video/mp4")).toBe(false);
    expect(isCompressibleImage("")).toBe(false);
  });
});

describe("scaledSize", () => {
  it("does not enlarge images already within the max edge", () => {
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(scaledSize(2560, 1440)).toEqual({ width: 2560, height: 1440 });
  });

  it("scales a 12MP photo down to the long-edge cap", () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 2560, height: 1920 });
  });
});

describe("replaceFilenameExt", () => {
  it("swaps the extension", () => {
    expect(replaceFilenameExt("IMG_1234.JPG", "webp")).toBe("IMG_1234.webp");
    expect(replaceFilenameExt("shot", "jpg")).toBe("shot.jpg");
  });
});

describe("compressImageForUpload", () => {
  it("returns the same file for gif and non-images", async () => {
    const gif = new File([new Uint8Array(800_000)], "a.gif", { type: "image/gif" });
    expect(await compressImageForUpload(gif)).toBe(gif);
    const audio = new File([new Uint8Array(800_000)], "a.webm", { type: "audio/webm" });
    expect(await compressImageForUpload(audio)).toBe(audio);
  });

  it("skips files at or under the skip-bytes threshold", async () => {
    const small = new File([new Uint8Array(IMAGE_COMPRESS.SKIP_BYTES)], "s.jpg", {
      type: "image/jpeg",
    });
    expect(await compressImageForUpload(small)).toBe(small);
  });

  it("re-encodes a large bitmap to a smaller webp file", async () => {
    const original = new File([new Uint8Array(2_000_000)], "photo.jpg", { type: "image/jpeg" });

    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({
        width: 4000,
        height: 3000,
        close: vi.fn(),
      })),
    );

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    HTMLCanvasElement.prototype.toBlob = function (cb, type) {
      const bytes = type === "image/webp" ? 80_000 : 120_000;
      cb(new Blob([new Uint8Array(bytes)], { type: type || "image/webp" }));
    } as typeof HTMLCanvasElement.prototype.toBlob;

    const out = await compressImageForUpload(original);
    expect(out).not.toBe(original);
    expect(out.type).toBe("image/webp");
    expect(out.name).toBe("photo.webp");
    expect(out.size).toBe(80_000);
  });

  it("keeps the original when compressed output is not smaller", async () => {
    const big = new File([new Uint8Array(500_000)], "photo.jpg", { type: "image/jpeg" });

    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({
        width: 800,
        height: 600,
        close: vi.fn(),
      })),
    );
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toBlob = function (cb, type) {
      cb(new Blob([new Uint8Array(600_000)], { type: type || "image/webp" }));
    } as typeof HTMLCanvasElement.prototype.toBlob;

    const out = await compressImageForUpload(big);
    expect(out).toBe(big);
  });
});
