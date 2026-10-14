import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { safeCoverUrl_ } from "../domain.mjs";
import { AppError } from "./store.mjs";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const coverDigest = (value) => createHash("sha256").update(value).digest("hex");

export function imageType(body) {
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

// Images are permanent database records. The file reader only migrates the old cache.
export function createCoverService(store, {
  fetchImpl = globalThis.fetch,
  legacyDirectory = join(dirname(resolve(process.env.BOOKS_DATABASE_PATH || "./data/books.sqlite")), "covers"),
} = {}) {
  const pending = new Map();
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


  async function ingest(url) {
    let file;
    try {
      file = await open(join(legacyDirectory, coverDigest(url) + ".cover"), "r");
      if ((await file.stat()).size <= MAX_IMAGE_BYTES) {
        const body = await file.readFile();
        const contentType = imageType(body);
        if (contentType) return store.covers.put({ body, contentType }, url);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    } finally {
      await file?.close();
    }
    try {
      return store.covers.put(await download(url), url);
    } catch {
      throw new AppError("Cover image is unavailable.", 502);
    }
  }
  return {
    async ensure(rawUrl) {
      const url = imageSource(rawUrl);
      const existing = store.covers.bySource(url);
      if (existing) return existing;
      if (!pending.has(url)) pending.set(url, ingest(url).finally(() => pending.delete(url)));
      return pending.get(url);
    },
    get(id) {
      if (!/^[a-f0-9]{64}$/.test(String(id || ""))) throw new AppError("Choose a stored cover.", 400);
      const image = store.covers.get(id);
      if (!image) throw new AppError("Cover not found.", 404);
      return { ...image, etag: '"' + id + '"' };
    },
  };
}
