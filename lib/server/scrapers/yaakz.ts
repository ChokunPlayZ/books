import {
  canonicalIsbn,
  catalogSeriesKey,
  digest,
  publisherKey,
  safeProductUrl,
  specialSet,
} from "../../domain.ts";
import { yaakzProducts, yaakzItems } from "../yaakz.ts";
import { cachedJson as cachedJson_, cacheJson as cacheJson_ } from "./cache.ts";
import { publisherRedirectIdentity } from "./http.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import { ISBN_GROUP_PREFIXES } from "../../domain/isbn.ts";
import type {
  IsbnSearchResult,
  ScraperContext,
  ScraperDefinition,
} from "./types.ts";

export const yaakz: ScraperDefinition = {
  id: "yaakz",
  titleLanguages: ["th", "en"],
  hosts: ["www.yaakz.com"],
  redirectIdentity: (url) => publisherRedirectIdentity("yaakz", url),
  isbnPriority: 20,
  isbnPrefixes: ISBN_GROUP_PREFIXES.thai,
  isbnWarning: "Yaakz is unavailable right now.",
  coverPriority: 20,
  coverWarning: "Could not check Yaakz for this volume.",
  create({
    cache,
    scrapeCache,
    fetchText: fetchText_,
    fetchJson: fetchJson_,
  }: ScraperContext) {
    async function fetchYaakzProduct_(url: string, refresh = false) {
      const safe = safeProductUrl(url, "yaakz");
      if (!safe) throw new Error("Choose a Yaakz product page.");
      const key = "yaakz-product:v1:" + digest(safe);
      const previous = await cachedJson_(cache, key);
      if (
        previous &&
        !refresh &&
        Date.now() - Date.parse(previous.checkedAt) < SCRAPE_TTL.product * 1000
      )
        return previous.product;
      const products = yaakzProducts(
        await fetchText_(safe, refresh, SCRAPE_TTL.product),
      );
      const uuid = safe.split("/").pop();
      const product = products.find((product) => String(product.uuid) === uuid);
      if (!product) throw new Error("Yaakz product markup changed.");
      await cacheJson_(cache, key, {
        product,
        checkedAt: new Date().toISOString(),
      });
      return product;
    }

    async function fetchYaakzPage_(
      endpoint: URL,
      refresh: boolean,
      maxAge: number,
    ) {
      const result = await fetchJson_<{
        data?: Record<string, unknown>[];
        total?: number;
      }>(endpoint.href, refresh, maxAge);
      if (
        !result ||
        !Array.isArray(result.data) ||
        !Number.isSafeInteger(result.total) ||
        result.total < result.data.length ||
        result.data.some((item) => !item || !/^\d+$/.test(String(item.uuid)))
      )
        throw new Error("Yaakz catalog markup changed.");
      return result;
    }

    async function fetchYaakzCatalog_(
      url: string,
      maxPages = 20,
      refresh = false,
      maxAge = SCRAPE_TTL.catalog,
    ) {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("q");
      const category = parsed.pathname.split("/").pop();
      const items = new Map(),
        parentIds = new Set();
      let pages = 0,
        complete = false,
        total = 0;
      for (let page = 1; page <= maxPages; page++) {
        const endpoint = new URL("https://www.yaakz.com/api/products");
        endpoint.searchParams.set(
          query ? "filter[q]" : "filter[parent_category_id]",
          query || (/^\d+$/.test(category) ? category : "976"),
        );
        endpoint.searchParams.set("page", String(page));
        endpoint.searchParams.set("per_page", "20");
        const result = await fetchYaakzPage_(endpoint, refresh, maxAge);
        total = result.total;
        const before = parentIds.size;
        result.data.forEach((item) => parentIds.add(item.uuid));
        if (parentIds.size === before && result.data.length) break;
        for (let start = 0; start < result.data.length; start += 3) {
          await Promise.all(
            result.data.slice(start, start + 3).map(async (product) => {
              if (product.has_subproduct)
                product = await fetchYaakzProduct_(
                  "https://www.yaakz.com/product/" + product.uuid,
                  refresh,
                );
              for (const item of yaakzItems(product))
                if (!specialSet(item.title)) items.set(item.id, item);
            }),
          );
        }
        pages++;
        if (parentIds.size === total) {
          complete = true;
          break;
        }
        if (!result.data.length) break;
      }
      return {
        items: [...items.values()],
        total,
        pages,
        complete,
        title: query || "Yaakz new arrivals",
        search: !!query,
      };
    }

    async function searchIsbn(
      isbn: string,
      refresh = false,
    ): Promise<IsbnSearchResult> {
      return scrapeCache.get(
        "publisher-isbn:v2:yaakz:" + isbn,
        { maxAge: SCRAPE_TTL.isbn, refresh },
        async () => {
          const result: IsbnSearchResult = {
            publisherId: "yaakz",
            isbn,
            url: "https://www.yaakz.com/search?q=" + isbn,
            items: [],
            warnings: [],
          };
          const endpoint = new URL("https://www.yaakz.com/api/products");
          endpoint.searchParams.set("filter[q]", isbn);
          endpoint.searchParams.set("page", "1");
          endpoint.searchParams.set("per_page", "20");
          const page = await fetchYaakzPage_(
            endpoint,
            refresh,
            SCRAPE_TTL.isbn,
          );
          if (!page.data.length && page.total !== 0)
            throw new Error("Yaakz ISBN search could not be read.");
          const candidates = [
            ...new Map(page.data.map((item) => [item.uuid, item])).values(),
          ].filter(
            (item) =>
              item.has_subproduct || !specialSet(item.title || item.name || ""),
          );
          let failure: unknown;
          for (const candidate of candidates.slice(0, 4)) {
            try {
              // Search listings omit barcodes, even for standalone products.
              // Only this product's own record or individual children can verify it.
              const product = await fetchYaakzProduct_(
                "https://www.yaakz.com/product/" + candidate.uuid,
                refresh,
              );
              const items = yaakzItems(product);
              if (!items.length)
                throw new Error("Yaakz product ISBN details are unavailable.");
              const regular = items.filter(
                (item) => !item.special && !item.bundle,
              );
              const item = regular.find((item) => item.isbn === isbn);
              if (item)
                return {
                  ...result,
                  items: [{ ...item, isbnVerified: true }],
                };
              if (regular.some((item) => !item.isbn))
                throw new Error("Yaakz product ISBN details are unavailable.");
            } catch (error) {
              failure = error;
            }
          }
          if (failure)
            throw new Error("Yaakz product ISBN details are unavailable.", {
              cause: failure,
            });
          return result;
        },
      );
    }

    return {
      searchIsbn,
      searchTitles: (query) =>
        fetchYaakzCatalog_(
          "https://www.yaakz.com/search?q=" + encodeURIComponent(query),
          1,
        ),
      catalog: async (url, refresh) =>
        await fetchYaakzCatalog_(url, 20, refresh),
      releases: async (refresh) =>
        (
          await fetchYaakzCatalog_(
            "https://www.yaakz.com/category/new-arrivals-best-sellers/976",
            2,
            refresh,
            SCRAPE_TTL.releases,
          )
        ).items,
      searchSeriesUrl: (series) =>
        "https://www.yaakz.com/search?q=" + encodeURIComponent(series),
      coverFromSeries: true,
      coverOptions: async (book, refresh) => {
        if (
          publisherKey(book.publisher) === "yaakz" ||
          !/\(TH\)/.test(book.type)
        )
          return [];
        const isbn = canonicalIsbn(book.isbn);
        const catalog = await fetchYaakzCatalog_(
          "https://www.yaakz.com/search?q=" +
            encodeURIComponent(isbn || book.series),
          20,
          refresh,
        );
        return catalog.items
          .filter((item) => {
            if (item.bundle || specialSet(item.title)) return false;
            return (
              (isbn && canonicalIsbn(item.isbn) === isbn) ||
              (!isbn &&
                catalogSeriesKey(item.series) ===
                  catalogSeriesKey(book.series) &&
                item.volume !== "" &&
                book.volume !== "" &&
                Number(item.volume) === Number(book.volume) &&
                item.type === book.type)
            );
          })
          .map((item) => ({
            ...item,
            coverUrl: item.coverUrl || "",
            url: book.publisherUrl || "",
            source: "Yaakz",
            sourceUrl: item.url,
          }));
      },
      lookupIsbn: async (isbn, refresh) =>
        (await searchIsbn(isbn, refresh)).items[0] || null,
      gallery: async (item, book, refresh) => {
        const options = item.coverUrl
          ? [item]
          : yaakzItems(await fetchYaakzProduct_(item.url, refresh));
        return options
          .filter((option) => {
            if (specialSet(option.title) || option.bundle) return false;
            return (
              (canonicalIsbn(book.isbn) &&
                canonicalIsbn(book.isbn) === canonicalIsbn(option.isbn)) ||
              (book.volume !== "" &&
                option.volume !== "" &&
                Number(option.volume) === Number(book.volume) &&
                (!option.type ||
                  option.type.replace(/\s*\(colou?r\)/gi, "").trim() ===
                    book.type.replace(/\s*\(colou?r\)/gi, "").trim()))
            );
          })
          .map((option) => ({ ...option, coverUrl: option.coverUrl || "" }));
      },
    };
  },
};
