import { canonicalIsbn, PUBLISHERS } from "../domain.ts";
import type {
  ScraperDebugRequest,
  ScraperDebugResult,
  ScraperDebugSource,
} from "../scraper-debug.ts";
import { AppError, type Store } from "./store.ts";
import { createScraperContext } from "./scrapers/http.ts";
import {
  createScraperRegistry,
  SCRAPER_SOURCES,
  supportsIsbn,
} from "./scrapers/registry.ts";
import type { ScraperCache, ScraperDefinition } from "./scrapers/types.ts";

// Keep diagnostic jobs bounded even when a source returns many large pages.
const MAX_TRACE_CHARACTERS = 32 * 1024 * 1024;
const cooldownKey = (key: string) =>
  key.endsWith(":retry") || key.endsWith(":cooldown");

export function createScraperDebugger(
  store: Store,
  fetchImpl = globalThis.fetch,
  definitions: readonly ScraperDefinition[] = SCRAPER_SOURCES,
) {
  function sources() {
    const context = createScraperContext(store.cache, fetchImpl, definitions);
    return createScraperRegistry(context, definitions);
  }
  async function getScraperDebugSources(): Promise<ScraperDebugSource[]> {
    store.requireAdmin();
    const registry = sources();
    return definitions
      .filter((source) => {
        const scraper = registry.get(source.id);
        return scraper?.lookupIsbn || scraper?.searchIsbn;
      })
      .map((source) => ({
        id: source.id,
        name:
          source.priceSource?.name ||
          PUBLISHERS.find((publisher) => publisher.id === source.id)?.name ||
          source.id,
      }));
  }
  function validateScraperDebug(request: ScraperDebugRequest) {
    store.requireAdmin();
    if (
      !request ||
      typeof request.isbn !== "string" ||
      request.isbn.length > 100 ||
      typeof request.providerId !== "string"
    )
      throw new AppError("Enter a valid ISBN and choose a provider.");
    const isbn = canonicalIsbn(request.isbn);
    const source = definitions.find(
      (source) => source.id === request.providerId,
    );
    const scraper = source && sources().get(source.id);
    if (!isbn || !source || (!scraper?.lookupIsbn && !scraper?.searchIsbn))
      throw new AppError("Enter a valid ISBN and choose a provider.");
    if (!supportsIsbn(source, isbn))
      throw new AppError("This provider does not support this ISBN prefix.");
    return { isbn, providerId: source.id };
  }
  async function debugScraperIsbn(
    request: ScraperDebugRequest,
  ): Promise<ScraperDebugResult> {
    const { isbn, providerId } = validateScraperDebug(request);
    const definition = definitions.find((source) => source.id === providerId)!;
    const started = Date.now();
    const report: ScraperDebugResult = {
      isbn,
      providerId,
      startedAt: new Date(started).toISOString(),
      durationMs: 0,
      responses: [],
      snapshots: [],
      cooldowns: [],
      result: null,
      error: "",
      stack: "",
    };
    // No successful shared cache can satisfy a debug run. Reuse only this run's
    // local values and durable failure cooldowns. Never change library metadata.
    const values = new Map<string, string>();
    const cache: ScraperCache = {
      async get(key) {
        if (cooldownKey(key)) {
          const value = await store.cache.get(key);
          if (value && !report.cooldowns.includes(key))
            report.cooldowns.push(key);
          return value;
        }
        return values.get(key) ?? null;
      },
      async put(key, value, seconds) {
        if (cooldownKey(key)) return store.cache.put(key, value, seconds);
        values.set(key, value);
      },
    };
    let remaining = MAX_TRACE_CHARACTERS;
    const context = createScraperContext(
      cache,
      fetchImpl,
      [definition],
      (response) => {
        const body = response.body.slice(0, remaining);
        remaining -= body.length;
        report.responses.push({
          ...response,
          body,
          truncated: body.length < response.body.length,
        });
      },
    );
    try {
      const scraper = createScraperRegistry(context, [definition]).require(
        providerId,
      );
      report.result = scraper.lookupIsbn
        ? await scraper.lookupIsbn(isbn, true)
        : await scraper.searchIsbn!(isbn, true);
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error);
      report.stack = error instanceof Error ? error.stack || "" : "";
    }
    for (const [key, value] of values) {
      if (!key.startsWith("scrape:v1:")) continue;
      try {
        const record = JSON.parse(value);
        if (
          typeof record.source === "string" &&
          !/^(text|json):/.test(record.source)
        )
          report.snapshots.push({ source: record.source, value: record.value });
      } catch {
        /* A provider's non-JSON working state is not a parser result. */
      }
    }
    report.durationMs = Date.now() - started;
    return report;
  }
  return { getScraperDebugSources, validateScraperDebug, debugScraperIsbn };
}
