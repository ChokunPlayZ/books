import { SCRAPE_TTL } from "../scrape-cache.ts";
import type { ScraperCache } from "./types.ts";

export function cachedJson(cache: ScraperCache, key: string) {
  try {
    const json = cache.get(key);
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

export function cacheJson(cache: ScraperCache, key: string, value: unknown) {
  cache.put(key, JSON.stringify(value), SCRAPE_TTL.retention);
}
