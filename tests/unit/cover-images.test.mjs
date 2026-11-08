import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { decode, isBlurhashValid } from "blurhash";
import {
  createCoverPreview,
  MAX_COVER_PIXELS,
} from "../../lib/server/cover-images.ts";
import { coverPlaceholderUrl } from "../../lib/domain/cover-placeholder.ts";

test("large covers become smaller, bounded WebP previews with valid BlurHashes", async () => {
  const original = await sharp(randomBytes(900 * 1400 * 3), {
    raw: { width: 900, height: 1400, channels: 3 },
  })
    .png()
    .toBuffer();
  const preview = await createCoverPreview(original);
  const metadata = await sharp(preview.body).metadata();
  assert.equal(metadata.format, "webp");
  assert.ok(metadata.width <= 528 && metadata.height <= 740);
  assert.ok(preview.body.length < original.length / 4);
  assert.equal(metadata.exif, undefined);
  assert.ok(isBlurhashValid(preview.blurhash).result);
  assert.equal(preview.blurhash.length, 36);
});

test("small/transparent covers are not enlarged and concurrent failures release processing slots", async () => {
  const original = await sharp({
    create: { width: 16, height: 24, channels: 4, background: "#33669980" },
  })
    .png()
    .toBuffer();
  const results = await Promise.allSettled([
    createCoverPreview(Buffer.from("not an image")),
    ...Array.from({ length: 5 }, () => createCoverPreview(original)),
  ]);
  assert.equal(results[0].status, "rejected");
  for (const result of results.slice(1)) {
    assert.equal(result.status, "fulfilled");
    const metadata = await sharp(result.value.body).metadata();
    assert.equal(metadata.width, 16);
    assert.equal(metadata.height, 24);
    assert.equal(metadata.hasAlpha, true);
  }
});

test("compressed images cannot exceed the decoded pixel budget", async () => {
  const original = await sharp({
    create: {
      width: 5000,
      height: Math.floor(MAX_COVER_PIXELS / 5000) + 1,
      channels: 3,
      background: "white",
    },
  })
    .png()
    .toBuffer();
  assert.ok(original.length < 5 * 1024 * 1024);
  await assert.rejects(createCoverPreview(original), /pixel limit/i);
});

test("BlurHash placeholders are tiny inline bitmaps with correctly decoded colors", async () => {
  const hash = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";
  const url = coverPlaceholderUrl(hash);
  assert.match(url, /^data:image\/bmp;base64,/);
  assert.ok(url.length < 1000);
  const body = Buffer.from(url.split(",")[1], "base64");
  assert.equal(body.readUInt32LE(2), body.length);
  assert.equal(body.readInt32LE(18), 12);
  assert.equal(body.readInt32LE(22), -16);
  const pixels = decode(hash, 12, 16);
  for (let i = 0; i < 12 * 16; i++) {
    assert.equal(body[54 + i * 3], pixels[i * 4 + 2]);
    assert.equal(body[55 + i * 3], pixels[i * 4 + 1]);
    assert.equal(body[56 + i * 3], pixels[i * 4]);
  }
  assert.equal(coverPlaceholderUrl(hash), url);
  for (const invalid of [undefined, "", "invalid", "x".repeat(167)])
    assert.equal(coverPlaceholderUrl(invalid), "");
});
