import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { safeCoverUrl_ } from "../domain.mjs";
import { AppError } from "./store.mjs";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FRESH_FOR = 30 * 86400000;
const hash = (value) => createHash("sha256").update(value).digest("hex");

function imageType(body) {
  if (body.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return "image/png";
  if (body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(body.toString("ascii", 0, 6)))
    return "image/gif";
  if (
    body.toString("ascii", 0, 4) === "RIFF" &&
    body.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (
    body.toString("ascii", 4, 8) === "ftyp" &&
    /avif|avis/.test(body.toString("ascii", 8, 40))
  )
    return "image/avif";
  return "";
}

function imageSource(raw) {
  const url = safeCoverUrl_(raw);
  if (!url || new URL(raw).protocol !== "https:")
    throw new AppError("Unsupported cover image source.");
  return url;
}

// Keep files in the database volume, outside the disposable Next.js build.
export function createCoverCache({
  directory = join(
    dirname(resolve(process.env.BOOKS_DATABASE_PATH || "./data/books.sqlite")),
    "covers",
  ),
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  const pending = new Map();

  async function readCached(path) {
    let file;
    try {
      file = await open(path, "r");
      const info = await file.stat();
      if (info.size > MAX_IMAGE_BYTES) return null;
      const body = await file.readFile();
      const contentType = imageType(body);
      return contentType
        ? { body, contentType, updatedAt: info.mtimeMs }
        : null;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    } finally {
      await file?.close();
    }
  }

  async function download(url) {
    const signal = AbortSignal.timeout(15000);
    for (let hop = 0; hop <= 3; hop++) {
      const response = await fetchImpl(url, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*" },
        redirect: "manual",
        cache: "no-store",
        signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location || hop === 3) throw new Error("Invalid image redirect.");
        url = imageSource(new URL(location, url).href);
        continue;
      }
      if (
        !response.ok ||
        !response.body ||
        Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES
      ) {
        await response.body?.cancel();
        throw new Error("Cover image is unavailable or too large.");
      }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_IMAGE_BYTES) {
            await reader.cancel();
            throw new Error("Cover image is too large.");
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      const body = Buffer.concat(chunks);
      const contentType = imageType(body);
      if (!contentType) throw new Error("Unsupported cover image format.");
      return { body, contentType };
    }
  }

  async function load(url) {
    const path = join(directory, hash(url) + ".cover");
    const cached = await readCached(path);
    if (cached && now() - cached.updatedAt < FRESH_FOR)
      return { ...cached, stale: false };
    try {
      const image = await download(url);
      await mkdir(directory, { recursive: true });
      // Rename only complete, validated images so concurrent readers never see a partial file.
      const temporary = path + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temporary, image.body, { flag: "wx" });
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return { ...image, stale: false };
    } catch {
      if (cached) return { ...cached, stale: true };
      throw new AppError("Cover image is unavailable.", 502);
    }
  }

  return {
    async get(rawUrl) {
      const url = imageSource(rawUrl);
      if (!pending.has(url))
        pending.set(
          url,
          load(url).finally(() => pending.delete(url)),
        );
      const image = await pending.get(url);
      return { ...image, etag: '"' + hash(image.body) + '"' };
    },
  };
}
