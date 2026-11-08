import sharp from "sharp";
import { encode } from "blurhash";

// Increment when encoding settings change; originals and their IDs never change.
export const COVER_PREVIEW_VERSION = 1;
export const MAX_COVER_PIXELS = 20_000_000;
const waiting: (() => void)[] = [];
let active = 0;

export async function createCoverPreview(body: Uint8Array) {
  // Bound decoded image memory/CPU, not just the compressed download size.
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    const webp = await sharp(body, { limitInputPixels: MAX_COVER_PIXELS })
      .timeout({ seconds: 5 })
      .rotate()
      .resize(528, 740, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();
    const { data, info } = await sharp(webp)
      .resize(32, 32, { fit: "inside" })
      .flatten({ background: "#f4f3ee" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      body: webp,
      blurhash: encode(
        new Uint8ClampedArray(data),
        info.width,
        info.height,
        4,
        4,
      ),
    };
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
