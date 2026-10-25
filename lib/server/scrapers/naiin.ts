import {
  attr,
  canonicalIsbn,
  catalogSeriesKey,
  meta,
  names,
  publisherKey,
  releaseBundle,
  safeCoverUrl,
  specialSet,
  splitBookTitle,
  structuredBooks,
  textHtml,
} from "../../domain.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import type {
  BookDetails,
  ScraperContext,
  ScraperDefinition,
} from "./types.ts";

export const naiin: ScraperDefinition = {
  id: "naiin",
  hosts: ["www.naiin.com"],
  priceSource: {
    name: "Naiin",
    currency: "THB",
    searchUrl: (isbn) => "https://www.naiin.com/search-result?title=" + isbn,
  },
  isbnPriority: 10,
  isbnWarning:
    "Naiin is unavailable right now. You can still search it using the link below.",
  coverPriority: 10,
  coverWarning: "Could not check Naiin for this ISBN.",
  create({ fetchText: fetchText_ }: ScraperContext) {
    async function lookupNaiin_(
      canonical,
      refresh = false,
    ): Promise<BookDetails | null> {
      const html = await fetchText_(
        "https://www.naiin.com/search-result?title=" +
          encodeURIComponent(canonical),
        refresh,
        SCRAPE_TTL.isbn,
      );
      const component = /<product-list\b[^>]*>/i.exec(html);
      if (!component) throw new Error("Search markup unavailable");
      let candidates;
      try {
        candidates = JSON.parse(attr(component[0], ":items"));
      } catch (e) {
        throw new Error("Search markup changed");
      }
      if (!Array.isArray(candidates)) throw new Error("Search markup changed");
      candidates = candidates
        .filter(function (v) {
          return (
            Number(v.ProductTypeId) === 1 && /^\d+$/.test(String(v.ProductID))
          );
        })
        .slice(0, 4);
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i],
          url = "https://www.naiin.com/product/detail/" + candidate.ProductID;
        const page = await fetchText_(url, refresh, SCRAPE_TTL.product),
          data = structuredBooks(page);
        const exact = data.find(function (b) {
          // A recommended book on this page cannot verify this listing's price.
          if (!b.url) {
            if (
              data.length !== 1 ||
              textHtml(b.name) !== textHtml(candidate.ProductName)
            )
              return false;
          } else {
            try {
              const productUrl = new URL(b.url);
              if (
                productUrl.origin + productUrl.pathname.replace(/\/$/, "") !==
                url
              )
                return false;
            } catch {
              return false;
            }
          }
          return [b.isbn, b.gtin13, b.sku].some(function (code) {
            return canonicalIsbn(code) === canonical;
          });
        });
        const metaIsbn = meta(page, "book:isbn");
        if (!exact && canonicalIsbn(metaIsbn) !== canonical) continue;
        const book = exact || {},
          title = book.name || candidate.ProductName || "";
        if (!title) continue;
        const parsed = splitBookTitle(title);
        const regularPrice =
          candidate.PriceFull === "" ? NaN : Number(candidate.PriceFull ?? NaN);
        const salePrice = candidate.PriceDiscount ?? candidate.PriceFull;
        const price = salePrice === "" ? NaN : Number(salePrice ?? NaN);
        const quantity =
          candidate.Quantity == null || candidate.Quantity === ""
            ? NaN
            : Number(candidate.Quantity);
        return {
          isbn: canonical,
          title: title,
          series: parsed.series,
          volume: parsed.volume,
          type: parsed.type,
          publisher: names(book.publisher) || candidate.PublisherName || "",
          authors: names(book.author) || candidate.AuthorName || "",
          source: "Naiin",
          price: Number.isFinite(price) && price >= 0 ? price : "",
          currency: "THB",
          availability:
            Number(candidate.IsPreOrder) === 1
              ? "Pre-order"
              : !Number.isFinite(quantity) || quantity < 0
                ? "Check availability"
                : quantity > 0
                  ? "In stock"
                  : "Out of stock",
          url: url,
          releaseDate: meta(page, "book:release_date"),
          regularPrice:
            Number.isFinite(regularPrice) && regularPrice >= 0
              ? regularPrice
              : "",
          coverUrl: safeCoverUrl(book.image || meta(page, "og:image")),
        };
      }
      return null;
    }

    async function lookupNaiinTitle_(book, refresh = false) {
      if (book.volume === "" || book.volume == null) return null;
      const html = await fetchText_(
        "https://www.naiin.com/search-result?title=" +
          encodeURIComponent(book.series + " เล่ม " + book.volume),
        refresh,
        SCRAPE_TTL.isbn,
      );
      const component = /<product-list\b[^>]*>/i.exec(html);
      if (!component) throw new Error("Naiin search unavailable.");
      const candidates = JSON.parse(attr(component[0], ":items"));
      if (!Array.isArray(candidates)) throw new Error("Naiin search changed.");
      for (const candidate of candidates
        .filter(
          (item) =>
            Number(item.ProductTypeId) === 1 &&
            /^\d+$/.test(String(item.ProductID)),
        )
        .slice(0, 4)) {
        const url =
          "https://www.naiin.com/product/detail/" + candidate.ProductID;
        const page = await fetchText_(url, refresh, SCRAPE_TTL.product);
        for (const product of structuredBooks(page)) {
          const title = product.name || candidate.ProductName || "";
          const parsed = splitBookTitle(title);
          const publisher = names(product.publisher) || candidate.PublisherName;
          if (
            specialSet(title) ||
            releaseBundle(title) ||
            parsed.volume === "" ||
            Number(parsed.volume) !== Number(book.volume) ||
            catalogSeriesKey(parsed.series) !== catalogSeriesKey(book.series) ||
            !publisher ||
            publisherKey(publisher) !== publisherKey(book.publisher) ||
            !parsed.type ||
            parsed.type !== book.type
          )
            continue;
          return {
            title,
            url,
            coverUrl: safeCoverUrl(product.image || meta(page, "og:image")),
          };
        }
      }
      return null;
    }

    return {
      lookupIsbn: lookupNaiin_,
      coverOptions: async (book, refresh) => {
        const isbn = canonicalIsbn(book.isbn);
        if (!isbn && !/\(TH\)/.test(book.type)) return [];
        const item = isbn
          ? await lookupNaiin_(isbn, refresh)
          : await lookupNaiinTitle_(book, refresh);
        return item?.coverUrl
          ? [
              {
                coverUrl: item.coverUrl,
                title: item.title,
                url: book.publisherUrl || "",
                source: "Naiin",
                sourceUrl: item.url,
              },
            ]
          : [];
      },
    };
  },
};
