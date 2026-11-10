import { canonicalIsbn } from "./isbn.ts";
import { money } from "./msrp.ts";
import { parsePageCount } from "./page-count.ts";
import { safeCoverUrl, safePublisherUrl } from "./urls.ts";
import { specialSet, releaseBundle } from "./titles.ts";

// Public scraper fields only. In particular, price paid, notes, shelf aliases,
// reading state and user-selected cover IDs must never enter this record.
export function scrapedMetadata(book) {
  const isbn = canonicalIsbn(book?.isbn);
  if (
    !isbn ||
    book.isbnVerified !== true ||
    book.special ||
    book.bundle ||
    book.variantGroup ||
    book.catalogVariant ||
    specialSet(book.title) ||
    releaseBundle(book.title)
  )
    return null;
  const text = (value) =>
    typeof value === "string" ? value.trim().slice(0, 2000) : "";
  const currency = text(book.msrpCurrency || book.currency).toUpperCase();
  const msrp = money(book.msrp);
  return {
    isbn,
    isbnVerified: true,
    title: text(book.title),
    series: text(book.series),
    volume: book.volume === "" || book.volume == null ? "" : money(book.volume),
    type: text(book.type),
    edition: text(book.edition),
    publisher: text(book.publisher),
    authors: text(book.authors),
    releaseDate: text(book.releaseDate),
    source: text(book.source),
    url: safePublisherUrl(book.url, ""),
    coverUrl: safeCoverUrl(book.coverUrl),
    pageCount: parsePageCount(book.pageCount),
    msrp: !currency || /^[A-Z]{3}$/.test(currency) ? msrp : ("" as const),
    msrpCurrency: msrp !== "" && /^[A-Z]{3}$/.test(currency) ? currency : "",
    checkedAt: text(book.checkedAt),
  };
}

export function fillScrapedMetadata(previous, incoming) {
  const next = { ...previous };
  for (const key of [
    "title",
    "series",
    "volume",
    "type",
    "edition",
    "publisher",
    "authors",
    "releaseDate",
    "source",
    "url",
    "coverUrl",
    "pageCount",
  ]) {
    if (
      (next[key] === "" || next[key] == null) &&
      incoming[key] !== "" &&
      incoming[key] != null
    )
      next[key] = incoming[key];
  }
  if (
    (next.msrp === "" || next.msrp == null) &&
    incoming.msrp !== "" &&
    incoming.msrp != null
  ) {
    if (
      !next.msrpCurrency ||
      !incoming.msrpCurrency ||
      next.msrpCurrency === incoming.msrpCurrency
    ) {
      next.msrp = incoming.msrp;
      next.msrpCurrency ||= incoming.msrpCurrency || "";
    }
  } else if (!next.msrpCurrency && next.msrp === incoming.msrp) {
    next.msrpCurrency = incoming.msrpCurrency || "";
  }
  return next;
}
