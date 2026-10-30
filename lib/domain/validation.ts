import { BOOK_APP, PUBLISHERS } from "./constants.ts";
import { normalizeIsbn } from "./isbn.ts";
import { safeCoverUrl, safePublisherUrl } from "./urls.ts";
import { normalizePageCount } from "./page-count.ts";

export function normalizeBook(b) {
  const values: (string | number)[] = BOOK_APP.fields.map(function (key) {
    const value =
      b[key] === undefined || b[key] === null ? "" : String(b[key]).trim();
    if (value.length > (key === "note" ? 2000 : 500))
      throw new Error(key + " is too long.");
    return value;
  });
  if (!values[1]) throw new Error("Enter a series or book title.");
  values[0] = normalizeIsbn(values[0]);
  if (!values[2]) throw new Error("Choose a book type.");
  if (!values[4]) throw new Error("Choose a reading status.");
  [5, 7].forEach(function (i) {
    if (values[i] !== "") {
      if (
        !/^\d+(?:\.\d+)?$/.test(String(values[i])) ||
        !Number.isFinite(Number(values[i]))
      ) {
        throw new Error(
          BOOK_APP.headers[i] + " must be a non-negative number.",
        );
      }
      values[i] = Number(values[i]);
    }
  });
  values[8] = values[8] ? dateSerial(values[8]) : "";
  return values;
}

export function dateSerial(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Choose a valid date.");
  const parts = value.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (
    parts[0] < 1900 ||
    parts[0] > 9999 ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error("Choose a valid date.");
  return Math.round((date.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
}

export function normalizePurchaseDetails(input: Record<string, unknown>) {
  const date = String(input.date ?? "").trim();
  const source = String(input.source ?? "").trim();
  const price = String(input.price ?? "").trim();
  if (source.length > 500) throw new Error("Bought from is too long.");
  if (date) dateSerial(date);
  if (
    price !== "" &&
    (!/^\d+(?:\.\d+)?$/.test(price) ||
      price.length > 500 ||
      !Number.isFinite(Number(price)))
  )
    throw new Error("Price paid must be a non-negative number.");
  return { date, source, price: price === "" ? ("" as const) : Number(price) };
}

export function bookMetadata(input) {
  const coverUrl = safeCoverUrl(input.coverUrl);
  const publisherUrl = safePublisherUrl(input.publisherUrl, input.publisher);
  if (input.coverUrl && !coverUrl)
    throw new Error(
      "Use a cover URL from a supported publisher or book metadata provider.",
    );
  if (input.publisherUrl && !publisherUrl)
    throw new Error("Use an HTTPS link on this publisher’s website.");
  return {
    coverUrl,
    publisherUrl,
    pageCount: normalizePageCount(input.pageCount),
  };
}

export function seriesCatalogRequest(request) {
  request = request || {};
  const series = String(request.series || "").trim(),
    publisher = PUBLISHERS.find(function (p) {
      return p.id === request.publisherId;
    });
  if (!series || series.length > 500 || !publisher)
    throw new Error("Choose a series and a supported publisher.");
  const type = String(request.type || "").trim();
  if (type.length > 100) throw new Error("Choose a valid book type.");
  return {
    series: series,
    publisherId: publisher.id,
    type: type,
    refresh: request.refresh === true,
  };
}
