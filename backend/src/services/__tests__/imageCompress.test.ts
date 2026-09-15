/**
 * 运行：cd backend && npx tsx --test src/services/__tests__/imageCompress.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  IMAGE_COMPRESS,
  compressRasterImage,
  isCompressibleImageMime,
  replaceFilenameExt,
} from "../imageCompress.js";

test("isCompressibleImageMime accepts raster stills and skips gif", () => {
  assert.equal(isCompressibleImageMime("image/jpeg"), true);
  assert.equal(isCompressibleImageMime("image/png"), true);
  assert.equal(isCompressibleImageMime("image/gif"), false);
  assert.equal(isCompressibleImageMime("audio/webm"), false);
});

test("replaceFilenameExt swaps the suffix", () => {
  assert.equal(replaceFilenameExt("IMG_1234.JPG", "webp"), "IMG_1234.webp");
});

test("compresses an oversized jpeg down to max-edge webp", async () => {
  const width = 4000;
  const height = 3000;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      raw[i] = (x * 3 + y) & 255;
      raw[i + 1] = (x * 7) & 255;
      raw[i + 2] = (y * 11) & 255;
    }
  }
  const src = await sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
  assert.ok(src.length > IMAGE_COMPRESS.SKIP_BYTES);

  const out = await compressRasterImage(src, "image/jpeg");
  assert.equal(out.mime, "image/webp");
  assert.equal(out.ext, "webp");
  assert.ok(out.buffer.length < src.length);

  const meta = await sharp(out.buffer).metadata();
  assert.ok((meta.width || 0) <= IMAGE_COMPRESS.MAX_EDGE);
  assert.ok((meta.height || 0) <= IMAGE_COMPRESS.MAX_EDGE);
  assert.equal(meta.format, "webp");
});

test("skips gif without rewriting the buffer", async () => {
  const gif = Buffer.from("GIF89a-not-a-real-gif");
  const out = await compressRasterImage(gif, "image/gif");
  assert.equal(out.mime, "image/gif");
  assert.equal(out.buffer, gif);
});

test("skips a small png already within the max edge", async () => {
  const src = await sharp({
    create: {
      width: 80,
      height: 60,
      channels: 3,
      background: { r: 10, g: 10, b: 10 },
    },
  })
    .png()
    .toBuffer();
  assert.ok(src.length <= IMAGE_COMPRESS.SKIP_BYTES);
  const out = await compressRasterImage(src, "image/png");
  assert.equal(out.mime, "image/png");
  assert.equal(out.buffer.length, src.length);
});
