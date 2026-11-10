import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { originalCoverUrl } from "../domain.ts";
import { AppError } from "./store.ts";
import { SCRAPE_TTL } from "./scrape-cache.ts";
import { outboundFetch } from "./outbound.ts";
import { readBody } from "./http.ts";
import { createCoverPreview } from "./cover-images.ts";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const coverDigest = (value) =>
  createHash("sha256").update(value).digest("hex");

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
  const url = originalCoverUrl(raw);
  if (!url || new URL(raw).protocol !== "https:")
    throw new AppError("Unsupported cover image source.");
  return url;
}

export async function attachCoverPlaceholders<T>(store, result: T): Promise<T> {
  const records: { coverId: string; coverBlurhash?: string }[] = [];
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.coverId === "string" && value.coverId) records.push(value);
    for (const child of Object.values(value)) visit(child);
  }
  visit(result);
  const hashes = await store.covers.blurhashes([
    ...new Set(records.map((r) => r.coverId)),
  ]);
  for (const record of records) {
    // Never trust placeholder metadata supplied by an imported/catalog record.
    delete record.coverBlurhash;
    if (hashes[record.coverId]) record.coverBlurhash = hashes[record.coverId];
  }
  return result;
}

// Images are permanent database records. The file reader only migrates the old cache.
export function createCoverService(
  store,
  {
    fetchImpl = globalThis.fetch,
    legacyDirectory = resolve(
      process.env.BOOKS_LEGACY_COVERS_PATH || "./data/covers",
    ),
  } = {},
) {
  const fetchRemote = outboundFetch(fetchImpl);
  const pending = new Map();
  const previews = new Map();
  async function prepare(image) {
    if (!previews.has(image.id)) {
      previews.set(
        image.id,
        (async () => {
          const existing = await store.covers.preview(image.id);
          if (existing) return existing;
          let preview;
          try {
            preview = await createCoverPreview(image.body);
          } catch {
            // Preserve older/undecodable originals. Remember failures so a bad
            // image cannot repeatedly trigger expensive decoding on each view.
            preview = { body: null, blurhash: "" };
          }
          return await store.covers.putPreview(image.id, preview);
        })().finally(() => previews.delete(image.id)),
      );
    }
    return await previews.get(image.id);
  }
  async function storeImage(image, url) {
    const stored = await store.covers.put(image, url);
    await prepare(stored);
    return stored;
  }
  async function download(url) {
    const signal = AbortSignal.timeout(15000);
    for (let hop = 0; hop <= 3; hop++) {
      const response = await fetchRemote(url, {
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
      const body = await readBody(response, MAX_IMAGE_BYTES, 15_000);
      const contentType = imageType(body);
      if (!contentType) throw new Error("Unsupported cover image format.");
      return { body, contentType };
    }
  }

  async function ingest(url) {
    let file;
    try {
      file = await open(
        join(legacyDirectory, coverDigest(url) + ".cover"),
        "r",
      );
      if ((await file.stat()).size <= MAX_IMAGE_BYTES) {
        const body = await file.readFile();
        const contentType = imageType(body);
        if (contentType) return await storeImage({ body, contentType }, url);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    } finally {
      await file?.close();
    }
    try {
      return await storeImage(await download(url), url);
    } catch {
      throw new AppError("Cover image is unavailable.", 502);
    }
  }
  return {
    async ensure(rawUrl) {
      const url = imageSource(rawUrl);
      const existing = await store.covers.bySource(url);
      if (existing) {
        await prepare(existing);
        return existing;
      }
      if (!pending.has(url)) {
        pending.set(
          url,
          (async () => {
            const retryKey = "cover:retry:v1:" + coverDigest(url);
            // Register pending work before the first database await so overlapping
            // requests still share one download.
            if (await store.cache.get(retryKey))
              throw new AppError(
                "Cover image is unavailable. Try again after the retry cooldown.",
                502,
              );
            return ingest(url).catch(async (error) => {
              await store.cache.put(retryKey, "1", SCRAPE_TTL.retry);
              throw error;
            });
          })().finally(() => pending.delete(url)),
        );
      }
      const image = await pending.get(url);
      await store.covers.allow(image.id);
      return image;
    },
    async get(id, optimized = false) {
      if (!/^[a-f0-9]{64}$/.test(String(id || "")))
        throw new AppError("Choose a stored cover.", 400);
      let preview = optimized ? await store.covers.preview(id) : null;
      let image;
      if (!preview?.body) {
        image = await store.covers.get(id);
        if (!image) throw new AppError("Cover not found.", 404);
        if (optimized && !preview) preview = await prepare(image);
      }
      if (preview?.body)
        return {
          id,
          body: preview.body,
          contentType: "image/webp",
          etag: '"' + coverDigest(preview.body) + '"',
        };
      return { ...image, etag: '"' + id + '"' };
    },
  };
}
