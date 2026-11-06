import { SCRAPE_TTL } from "../scrape-cache.ts";
import type { ScraperCache } from "./types.ts";

export async function cachedJson(cache: ScraperCache, key: string) {
  try {
    const json = await cache.get(key);
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

export async function cacheJson(
  cache: ScraperCache,
  key: string,
  value: unknown,
) {
  await cache.put(key, JSON.stringify(value), SCRAPE_TTL.retention);
}
