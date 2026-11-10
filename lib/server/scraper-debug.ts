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
import {
  formatScrapeDiagnostic,
  recordScrapeDiagnostic,
  recordScrapeError,
  withScrapeDiagnostics,
  withScrapeSource,
} from "./scrape-diagnostics.ts";
import {
  searchSourceTitles,
  supportsTitleSearch,
} from "./scrapers/title-search.ts";

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
        return (
          scraper &&
          (scraper.lookupIsbn ||
            scraper.searchIsbn ||
            supportsTitleSearch(scraper))
        );
      })
      .map((source) => ({
        id: source.id,
        isbn: !!(
          registry.get(source.id)?.lookupIsbn ||
          registry.get(source.id)?.searchIsbn
        ),
        title: supportsTitleSearch(registry.require(source.id)),
        name:
          source.priceSource?.name ||
          PUBLISHERS.find((publisher) => publisher.id === source.id)?.name ||
          source.id,
      }));
  }
  function validateScraperDebug(
    request: ScraperDebugRequest,
  ): ScraperDebugRequest {
    store.requireAdmin();
    if (
      !request ||
      (request.isbn !== undefined &&
        (typeof request.isbn !== "string" || request.isbn.length > 100)) ||
      (request.query !== undefined &&
        (typeof request.query !== "string" || request.query.length > 200)) ||
      (request.isbn !== undefined && request.query !== undefined) ||
      typeof request.providerId !== "string"
    )
      throw new AppError("Enter a valid ISBN or title and choose a provider.");
    const query = (request.isbn ?? request.query ?? "")
      .trim()
      .normalize("NFKC");
    const isbn = request.isbn !== undefined ? canonicalIsbn(query) : "";
    const source = definitions.find(
      (source) => source.id === request.providerId,
    );
    const scraper = source && sources().get(source.id);
    if (
      !source ||
      !scraper ||
      query.length < 2 ||
      query.length > 200 ||
      (request.isbn !== undefined && !isbn)
    )
      throw new AppError("Enter a valid ISBN or title and choose a provider.");
    if (isbn && !scraper.lookupIsbn && !scraper.searchIsbn)
      throw new AppError("This provider does not support ISBN search.");
    if (!isbn && !supportsTitleSearch(scraper))
      throw new AppError("This provider does not support title search.");
    if (isbn && !supportsIsbn(source, isbn))
      throw new AppError("This provider does not support this ISBN prefix.");
    return { ...(isbn ? { isbn } : { query }), providerId: source.id };
  }
  async function debugScraperIsbn(
    request: ScraperDebugRequest,
  ): Promise<ScraperDebugResult> {
    const validated = validateScraperDebug(request);
    const { providerId } = validated;
    const isbn = validated.isbn || "";
    const query = isbn || validated.query!;
    const definition = definitions.find((source) => source.id === providerId)!;
    const started = Date.now();
    const report: ScraperDebugResult = {
      isbn,
      query,
      mode: isbn ? "isbn" : "title",
      outcome: "failed",
      message: "",
      diagnostics: [],
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
    await withScrapeDiagnostics(report.diagnostics, () =>
      withScrapeSource(
        providerId,
        isbn ? "lookupIsbn" : "searchTitles",
        async () => {
          try {
            const scraper = createScraperRegistry(context, [
              definition,
            ]).require(providerId);
            report.result = isbn
              ? scraper.lookupIsbn
                ? await scraper.lookupIsbn(isbn, true)
                : await scraper.searchIsbn!(isbn, true)
              : await searchSourceTitles(context, scraper, query);
            const result = report.result as {
              items?: unknown[];
              warnings?: string[];
            } | null;
            const found =
              result &&
              (!Array.isArray(result.items) || result.items.length > 0);
            const failures = report.diagnostics.filter(
              (diagnostic) =>
                diagnostic.kind !== "not_found" &&
                ![404, 410].includes(diagnostic.status || 0),
            );
            if (!found && (failures.length || result?.warnings?.length)) {
              report.error =
                failures.map(formatScrapeDiagnostic).join("\n") ||
                result!.warnings!.join("\n");
            } else {
              report.outcome = found ? "found" : "not_found";
              report.message = found
                ? "Matching results returned."
                : "The scraper returned no matching results. Review the source responses and diagnostics below.";
              if (!found)
                recordScrapeDiagnostic({
                  kind: "not_found",
                  message: `No matching result returned for ${JSON.stringify(query)}.`,
                });
            }
          } catch (error) {
            recordScrapeError(error);
            report.error = report.diagnostics
              .filter((diagnostic) => diagnostic.kind !== "not_found")
              .map(formatScrapeDiagnostic)
              .join("\n");
            report.stack = error instanceof Error ? error.stack || "" : "";
          }
        },
      ),
    );
    if (report.error) report.message = report.error;
    // A debug run has its own bounded capture, but its cause also belongs in
    // the parent queue attempt's permanent event history.
    for (const diagnostic of report.diagnostics)
      recordScrapeDiagnostic(diagnostic);
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
