import { attr, textHtml } from "./html.ts";
import { canonicalIsbn } from "./isbn.ts";
import { digest } from "./hash.ts";
import { releaseItem } from "./releases.ts";
import { safeCoverUrl, safeProductUrl, safeSeriesCatalogUrl } from "./urls.ts";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function raw(value: unknown, key: string): string {
  const field = object(object(value)[key]).raw;
  return typeof field === "string" ? field : "";
}
function classes(tag: string): string[] {
  return attr(tag, "class").split(/\s+/);
}
function absolute(raw: string): string {
  try {
    return new URL(raw, "https://yenpress.com/").href;
  } catch {
    return "";
  }
}
export function yenPressSearchPage(data: unknown) {
  const value = object(data),
    page = object(object(value.meta).page);
  if (
    !Array.isArray(value.results) ||
    !Number.isSafeInteger(page.current) ||
    Number(page.current) < 1 ||
    !Number.isSafeInteger(page.total_pages) ||
    Number(page.total_pages) < 0 ||
    !Number.isSafeInteger(page.total_results) ||
    Number(page.total_results) < 0
  )
    throw new Error("Yen Press catalog search changed.");
  if (
    value.results.length > 1000 ||
    value.results.some((record) => !raw(record, "id"))
  )
    throw new Error("Yen Press catalog records changed.");
  return {
    records: value.results as unknown[],
    ids: value.results.map((record) => raw(record, "id")),
    current: Number(page.current),
    pages: Number(page.total_pages),
    total: Number(page.total_results),
  };
}

export function yenPressDirectoryTitles(records: unknown[]) {
  const titles = new Map();
  for (const record of records) {
    const title = textHtml(raw(record, "title"));
    const url = safeSeriesCatalogUrl(absolute(raw(record, "url")), "yenpress");
    if (
      !url ||
      !title ||
      /\(audio\)/i.test(title) ||
      raw(record, "imprint_id") === "3"
    )
      continue;
    const type = /\((?:light\s*novel|novel)\)/i.test(title)
      ? "LN (EN)"
      : /\((?:manga|comic)\)/i.test(title)
        ? "Manga (EN)"
        : raw(record, "imprint_id") === "2"
          ? "LN (EN)"
          : raw(record, "imprint_id") === "5"
            ? "Manga (EN)"
            : "";
    titles.set(url, {
      id: "yenpress:title:" + digest(url),
      publisherId: "yenpress",
      publisher: "Yen Press",
      title,
      series: title,
      url,
      type,
      categories: [{ url, type }],
      volume: "",
      isbn: "",
      coverUrl: "",
      directory: true,
    });
  }
  return [...titles.values()].sort((a, b) => a.series.localeCompare(b.series));
}

function item(
  title: string,
  url: string,
  type: string,
  coverUrl: string,
  series = "",
) {
  const book = releaseItem(
    "yenpress",
    title,
    url,
    "",
    /\/titles\/(\d{13})-/.exec(url)?.[1],
    type,
  );
  book.series = series || book.series.replace(/,\s*$/, "");
  book.coverUrl = safeCoverUrl(coverUrl, url);
  return book;
}

export function yenPressSeriesCatalog(html: string, url: string) {
  if (!safeSeriesCatalogUrl(url, "yenpress"))
    throw new Error("Choose a Yen Press series page.");
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const section = [
    ...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi),
  ].find(
    (section) =>
      attr(section[0].slice(0, section[0].indexOf(">") + 1), "id") ===
      "volumes-list",
  );
  if (!heading || !section) throw new Error("Yen Press series markup changed.");
  const title = textHtml(heading.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, ""));
  const count = /<sup\b[^>]*>\s*([\d,]+)\s*<\/sup>/i.exec(heading);
  const total = count ? Number(count[1].replaceAll(",", "")) : null;
  const ownHeading = html.slice(0, html.indexOf(heading));
  const category = /href=["']\/category\/(light-novels|manga|comics)["']/i.exec(
    ownHeading.slice(ownHeading.lastIndexOf("<section")),
  )?.[1];
  const type =
    category === "light-novels" ? "LN (EN)" : category ? "Manga (EN)" : "";
  if (!type) throw new Error("Yen Press series format unavailable.");
  const { items, nextUrl } = yenPressSeriesPage(section[1], url, title, type);
  const complete = yenPressSeriesComplete(items, total, nextUrl);
  if (!items.length && total !== 0)
    throw new Error("Yen Press series listings unavailable.");
  return { title, type, items, total, complete, pages: 1, nextUrl };
}

export function yenPressSeriesComplete(
  items: { volume: number | ""; bundle: boolean }[],
  total: number | null,
  nextUrl: string,
): boolean {
  if (total === null || nextUrl) return false;
  // The heading counts numbered volumes; collector editions can add unnumbered listings.
  const numbered = new Set(
    items
      .filter((item) => item.volume !== "" && !item.bundle)
      .map((item) => Number(item.volume)),
  );
  return (numbered.size || items.length) === total;
}

export function yenPressSeriesPage(
  html: string,
  seriesUrl: string,
  title: string,
  type: string,
) {
  const items = new Map();
  for (const anchor of html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []) {
    const tag = anchor.slice(0, anchor.indexOf(">") + 1);
    const productUrl = safeProductUrl(absolute(attr(tag, "href")), "yenpress");
    const image = /<img\b[^>]*>/i.exec(anchor)?.[0] || "";
    const name = textHtml(
      /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(anchor)?.[1] || attr(image, "alt"),
    );
    if (!productUrl || !name) continue;
    items.set(
      productUrl,
      item(
        name,
        productUrl,
        type,
        attr(image, "data-src") || attr(image, "src"),
        title,
      ),
    );
  }
  const next = (html.match(/<a\b[^>]*>/gi) || []).find((tag) =>
    classes(tag).includes("show-more"),
  );
  return {
    items: [...items.values()],
    nextUrl: next
      ? yenPressSeriesNextUrl(attr(next, "data-url"), seriesUrl)
      : "",
  };
}

export function yenPressSeriesNextUrl(raw: string, seriesUrl: string): string {
  const validSeries = safeSeriesCatalogUrl(seriesUrl, "yenpress");
  const next = new URL(raw, "https://yenpress.com/");
  const keys = [...next.searchParams.keys()];
  if (
    !validSeries ||
    next.origin !== "https://yenpress.com" ||
    next.username ||
    next.password ||
    next.hash ||
    next.pathname !== "/series/get_more/" + validSeries.split("/").pop() ||
    !/^\d{1,8}$/.test(next.searchParams.get("next_ord") || "") ||
    keys.length < 2 ||
    keys.length > 5 ||
    new Set(keys).size !== keys.length ||
    keys.some(
      (key) =>
        key !== "next_ord" &&
        (!/^format\[[0-3]\]$/.test(key) ||
          !["Paperback", "Hardback"].includes(
            next.searchParams.get(key) || "",
          )),
    )
  )
    throw new Error("Unsupported Yen Press series continuation.");
  return next.href;
}

export function yenPressCalendar(html: string) {
  if (
    !/id=["']submitFilters["']/.test(html) ||
    !/class=["'][^"']*\breleases-box\b/.test(html)
  )
    throw new Error("Yen Press release calendar changed.");
  const year = (html.match(/<option\b[^>]*>/gi) || []).find(
    (tag) =>
      /\sselected(?:\s|=|>)/.test(tag) &&
      /^\d{4}$/.test(attr(tag, "data-year")),
  );
  const records = new Map<
    string,
    ReturnType<typeof item> & { lookupIsbn: string }
  >();
  for (const anchor of html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []) {
    if (!/class=["'][^"']*\breleased-box\b/.test(anchor)) continue;
    const url = safeProductUrl(
      absolute(attr(anchor.slice(0, anchor.indexOf(">") + 1), "href")),
      "yenpress",
    );
    const title = textHtml(
      /<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(anchor)?.[1] || "",
    );
    const label = (anchor.match(/<span\b[^>]*>[\s\S]*?<\/span>/gi) || []).find(
      (span) =>
        classes(span.slice(0, span.indexOf(">") + 1)).includes("white-label"),
    );
    const category = textHtml(label || "").toLowerCase();
    if (
      !url ||
      !title ||
      !["novels", "manga", "comics"].includes(category) ||
      /\bchapter\s+\d/i.test(title)
    )
      continue;
    const image = /<img\b[^>]*>/i.exec(anchor)?.[0] || "";
    const book = item(
      title,
      url,
      category === "novels" ? "LN (EN)" : "Manga (EN)",
      attr(image, "src") || attr(image, "data-src"),
    );
    const date = textHtml(
      /<p\b[^>]*class=["'][^"']*\blabel-date\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(
        anchor,
      )?.[1] || "",
    );
    book.availability = date
      ? "Release date: " + date + (year ? " " + attr(year, "data-year") : "")
      : "";
    const lookupIsbn = canonicalIsbn(/\/titles\/(\d{13})-/.exec(url)?.[1]);
    if (lookupIsbn) records.set(lookupIsbn, { ...book, lookupIsbn });
  }
  return [...records.values()].slice(0, 200);
}

export function yenPressPrintReleases(
  data: unknown,
  calendar: ReturnType<typeof yenPressCalendar>,
) {
  const page = yenPressSearchPage(data);
  if (
    page.current !== 1 ||
    page.pages > 1 ||
    page.records.length !== page.total
  )
    throw new Error("Yen Press release search is incomplete.");
  const physical = new Map<string, { url: string; type: string }>();
  for (const record of page.records) {
    const isbn = canonicalIsbn(raw(record, "isbn")),
      format = raw(record, "type");
    const url = safeProductUrl(absolute(raw(record, "url")), "yenpress");
    if (
      isbn &&
      url &&
      canonicalIsbn(/\/titles\/(\d{13})-/.exec(url)?.[1]) === isbn &&
      /^(?:books-manga|books-comics|books-light-novels)$/.test(format)
    )
      physical.set(isbn, {
        url,
        type: format === "books-light-novels" ? "LN (EN)" : "Manga (EN)",
      });
  }
  return calendar.flatMap((book) => {
    const record = physical.get(book.lookupIsbn);
    const { lookupIsbn: _, ...release } = book;
    return record
      ? [{ ...release, ...record, id: "yenpress:" + digest(record.url) }]
      : [];
  });
}
