import { safeProductUrl, safePublisherTitleUrl } from "../../domain/urls.ts";
import { createScrapeCache, SCRAPE_TTL } from "../scrape-cache.ts";
import type {
  ScraperCache,
  ScraperContext,
  ScraperDefinition,
} from "./types.ts";

// A redirect may add a descriptive slug, but must still identify the same resource.
export function publisherRedirectIdentity(id: string, value: URL): string {
  return (
    (["animag", "dexpress"].includes(id) && safeProductUrl(value.href, id)) ||
    safePublisherTitleUrl(value.origin + value.pathname, id) ||
    (!["animag", "dexpress"].includes(id) &&
      safeProductUrl(value.origin + value.pathname, id)) ||
    ""
  );
}

export function createScraperContext(
  cache: ScraperCache,
  fetchImpl: typeof fetch,
  definitions: readonly ScraperDefinition[],
): ScraperContext {
  const scrapeCache = createScrapeCache(cache);
  const allowed = new Set(definitions.flatMap((source) => source.hosts));
  async function requestRemote(url: string, options: RequestInit = {}) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !allowed.has(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.port
    )
      throw new Error("Unsupported catalog source.");
    const fetchOptions: RequestInit = {
      ...options,
      headers: { "User-Agent": "Mozilla/5.0", ...options.headers },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    };
    let current = parsed,
      response;
    for (let hop = 0; hop <= 3; hop++) {
      response = await fetchImpl(current.href, fetchOptions);
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      let location = response.headers.get("location");
      if (
        !definitions.some(
          (source) =>
            source.hosts.includes(current.hostname) && source.redirectIdentity,
        ) ||
        !location ||
        hop === 3
      )
        throw new Error("Unsupported catalog redirect.");
      // This publisher sends raw UTF-8 Thai slugs in Location. Fetch exposes
      // header bytes as Latin-1; restore UTF-8 before URL percent-encoding.
      if (
        /[^\x00-\x7f]/.test(location) &&
        [...location].every((char) => char.charCodeAt(0) <= 255)
      ) {
        try {
          location = new TextDecoder("utf-8", { fatal: true }).decode(
            Uint8Array.from([...location], (char) => char.charCodeAt(0)),
          );
        } catch {}
      }
      const next = new URL(location, current);
      if (!next.search) next.search = current.search;
      const canonical = definitions.find((source) =>
        source.hosts.includes(current.hostname),
      )?.redirectIdentity;
      if (
        next.protocol !== "https:" ||
        next.hostname !== current.hostname ||
        next.username ||
        next.password ||
        next.port ||
        !canonical?.(current) ||
        canonical(next) !== canonical(current)
      )
        throw new Error("Unsupported catalog redirect.");
      await response.body?.cancel();
      current = next;
    }
    let body = "",
      size = 0;
    if (response.body) {
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Catalog response too large.");
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    }
    const headers: Record<string, string | string[]> = Object.fromEntries(
      response.headers,
    );
    headers["set-cookie"] = response.headers.getSetCookie?.() || [];
    return { status: response.status, body, headers };
  }

  async function fetchText_(
    url: string,
    refresh = false,
    maxAge = SCRAPE_TTL.catalog,
    options: RequestInit = {},
  ) {
    return scrapeCache.get(
      "text:" + new URL(url).href,
      { maxAge, refresh },
      async () => {
        const response = await requestRemote(url, options);
        if (response.status !== 200) throw new Error("Website unavailable");
        return response.body;
      },
    );
  }

  async function fetchJson_<T = unknown>(
    url: string,
    refresh = false,
    maxAge = SCRAPE_TTL.catalog,
  ): Promise<T> {
    return scrapeCache.get(
      "json:" + new URL(url).href,
      { maxAge, refresh },
      async () => {
        const response = await requestRemote(url);
        if (response.status !== 200)
          throw new Error("Book lookup service returned " + response.status);
        return JSON.parse(response.body) as T;
      },
    );
  }

  return {
    cache,
    scrapeCache,
    requestRemote,
    fetchText: fetchText_,
    fetchJson: fetchJson_,
  };
}
