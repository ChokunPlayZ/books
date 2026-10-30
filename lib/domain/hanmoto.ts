import { attr, meta, textHtml } from "./html.ts";
import { canonicalIsbn } from "./isbn.ts";
import { splitKodanshaTitle } from "./titles.ts";
import { safeCoverUrl } from "./urls.ts";
import { parsePageCount } from "./page-count.ts";

export function hanmotoBook(html: string, isbn: string) {
  const statedIsbn = canonicalIsbn(meta(html, "books:isbn"));
  if (!statedIsbn) throw new Error("Hanmoto book ISBN unavailable.");
  if (statedIsbn !== isbn) return null;
  const article = [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi)]
    .map((match) => match[0])
    .find((tag) =>
      attr(tag.slice(0, tag.indexOf(">") + 1), "class")
        .split(/\s+/)
        .includes("bd-isbn"),
    );
  if (!article) throw new Error("Hanmoto book markup changed.");
  const tags = article.match(/<[a-z][^>]*>/gi) || [];
  const codes = tags.find((tag) => attr(tag, "data-book-isbn13"));
  if (canonicalIsbn(attr(codes || "", "data-book-isbn13")) !== isbn)
    throw new Error("Hanmoto book identity unavailable.");
  // Ruby readings duplicate the Japanese title and are not part of its name.
  const title = textHtml(
    (/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(article)?.[1] || "").replace(
      /<(rt|rp)\b[^>]*>[\s\S]*?<\/\1>/gi,
      "",
    ),
  );
  if (!title) throw new Error("Hanmoto book title unavailable.");
  const publishers = tags.find((tag) => attr(tag, "data-book-publisher"));
  const authors = tags
    .map((tag) => attr(tag, "data-book-author-name"))
    .filter(Boolean);
  const published = tags.find(
    (tag) => attr(tag, "itemprop") === "datePublished",
  );
  const cover = safeCoverUrl(meta(html, "og:image"));
  // Generic logos, placeholders and other volumes' images are never covers.
  const coverUrl =
    cover &&
    new URL(cover).hostname === "img.hanmoto.com" &&
    new RegExp("^/bd/img/" + isbn + "(?:_(?:600|0))?\\.jpg$").test(
      new URL(cover).pathname,
    )
      ? cover
      : "";
  return {
    isbn,
    title,
    volume: splitKodanshaTitle(title).volume,
    publisher: attr(publishers || "", "data-book-publisher"),
    authors: [...new Set(authors)].join(", "),
    releaseDate: attr(published || "", "content"),
    pageCount: parsePageCount(
      attr(
        tags.find((tag) => attr(tag, "itemprop") === "numberOfPages") || "",
        "content",
      ),
    ),
    source: "Hanmoto",
    url: "https://www.hanmoto.com/bd/isbn/" + isbn,
    coverUrl,
  };
}
