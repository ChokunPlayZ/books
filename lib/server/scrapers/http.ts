import { safeProductUrl, safePublisherTitleUrl } from "../../domain/urls.ts";
import { createScrapeCache, SCRAPE_TTL } from "../scrape-cache.ts";
import { outboundFetch } from "../outbound.ts";
import { readBody } from "../http.ts";
import {
  backgroundRequest,
  isBackgroundScrape,
  minimumScrapeDelay,
} from "../scrape-runtime.ts";
import { crawlRobots } from "../crawl-robots.ts";
import type { ScraperDebugResponse } from "../../scraper-debug.ts";
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
  onResponse?: (response: ScraperDebugResponse) => void,
): ScraperContext {
  const fetchRemote = outboundFetch(fetchImpl);
  const scrapeCache = createScrapeCache(cache);
  const allowed = new Set(definitions.flatMap((source) => source.hosts));
  const robotsPending = new Map<string, Promise<string>>();
  async function requestRemote(url: string, options: RequestInit = {}) {
    if (isBackgroundScrape()) {
      const parsed = new URL(url),
        origin = parsed.origin;
      if (!robotsPending.has(origin))
        robotsPending.set(
          origin,
          (async () => {
            const key = "crawler:robots:v1:" + origin;
            const cached = await cache.get(key);
            if (cached !== null) return cached;
            const robots = await requestUncached(origin + "/robots.txt");
            if (![200, 404, 410].includes(robots.status))
              throw new Error(
                "Could not check publisher robots.txt; crawl stopped safely.",
              );
            const text = robots.status === 200 ? robots.body : "";
            await cache.put(key, text || "# No rules", 86400);
            return text;
          })().catch((error) => {
            robotsPending.delete(origin);
            throw error;
          }),
        );
      const policy = crawlRobots(await robotsPending.get(origin), parsed);
      minimumScrapeDelay(policy.delay);
      if (!policy.allowed)
        throw new Error("Publisher robots.txt disallows this crawl URL.");
    }
    return requestUncached(url, options);
  }
  async function requestUncached(url: string, options: RequestInit = {}) {
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
      headers: {
        "User-Agent": isBackgroundScrape()
          ? "meemai/1.0 (manual publisher cache warm-up)"
          : "Mozilla/5.0",
        ...options.headers,
      },
      redirect: "manual",
      cache: "no-store",
    };
    let current = parsed;
    for (let hop = 0; hop <= 3; hop++) {
      const response = await backgroundRequest(current.href, async () => {
        const started = Date.now();
        const trace: ScraperDebugResponse = {
          url: current.href,
          method: fetchOptions.method || "GET",
          startedAt: new Date(started).toISOString(),
          durationMs: 0,
          status: null,
          contentType: "",
          headers: {},
          body: "",
          bytes: 0,
          error: "",
        };
        try {
          const remote = await fetchRemote(current.href, {
            ...fetchOptions,
            signal: AbortSignal.timeout(15000),
          });
          trace.status = remote.status;
          trace.contentType = remote.headers.get("content-type") || "";
          if (onResponse)
            for (const name of [
              "content-type",
              "content-length",
              "content-encoding",
              "location",
              "retry-after",
              "server",
            ])
              if (remote.headers.has(name))
                trace.headers[name] = remote.headers.get(name)!;
          const redirect = [301, 302, 303, 307, 308].includes(remote.status);
          const body = redirect
            ? ""
            : (await readBody(remote, 8 * 1024 * 1024, 15_000)).toString(
                "utf8",
              );
          if (redirect) await remote.body?.cancel();
          trace.body = body;
          if (onResponse) trace.bytes = Buffer.byteLength(body);
          const headers: Record<string, string | string[]> = Object.fromEntries(
            remote.headers,
          );
          headers["set-cookie"] = remote.headers.getSetCookie?.() || [];
          return { status: remote.status, body, headers, redirect };
        } catch (error) {
          trace.error = error instanceof Error ? error.message : String(error);
          throw error;
        } finally {
          trace.durationMs = Date.now() - started;
          onResponse?.(trace);
        }
      });
      if (!response.redirect) return response;
      let location = String(response.headers.location || "");
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
      current = next;
    }
    throw new Error("Unsupported catalog redirect.");
  }

  async function fetchText_(
    url: string,
    refresh = false,
    maxAge = SCRAPE_TTL.catalog,
    options: RequestInit = {},
  ) {
    return await scrapeCache.get(
      "text:" + new URL(url).href,
      {
        maxAge,
        refresh,
        permanent: async () =>
          !!(await cache.get("known-product:v1:" + new URL(url).href)),
      },
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
    return await scrapeCache.get(
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
