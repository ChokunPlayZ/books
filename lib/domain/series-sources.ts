import { attr, descriptionText, textHtml, structuredBooks } from "./html.ts";
import {
  mergeSeriesMetadata,
  textLanguage,
  type SeriesProfile,
  type SeriesFact,
} from "./series-info.ts";
import { canonicalIsbn } from "./isbn.ts";

// Run on an individual provider response, never a blended metadata aggregate:
// a filled author must not be attributed to a different provider's URL.
export function sourceBookFacts(book: {
  authors?: string;
  publisher?: string;
  source?: string;
  url?: string;
  releaseDate?: string;
}): SeriesFact[] {
  return [
    ["Author", book.authors],
    ["Publisher", book.publisher],
    ["Release date", book.releaseDate],
  ].flatMap(([label, value]) =>
    value && book.url
      ? [
          {
            label,
            value,
            source: book.source || book.publisher || "Publisher",
            url: book.url,
          },
        ]
      : [],
  );
}

export function phoenixSeriesUrl(raw: unknown) {
  try {
    const url = new URL(String(raw));
    if (
      url.origin === "https://www.phoenixnext.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^\/series\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)
    )
      return url.origin + url.pathname.replace(/\/$/, "");
  } catch {}
  return "";
}

const labels: Record<string, string> = {
  รูปแบบ: "Format",
  แต่งเรื่อง: "Author",
  ผู้แต่ง: "Author",
  ภาพประกอบ: "Artist",
  ผู้วาด: "Artist",
  เริ่มเผยแพร่: "Publication year",
  เรท: "Age rating",
  สำนักพิมพ์: "Publisher",
  ผู้แปล: "Translator",
  จำนวนหน้า: "Pages",
  วันวางจำหน่าย: "Release date",
  ขนาด: "Dimensions",
};

export function htmlPublicationFacts(
  html: string,
  source: string,
  url: string,
  includeTables = true,
): SeriesFact[] {
  const facts: SeriesFact[] = [];
  const add = (label: string, value: unknown) => {
    const text = descriptionText(value);
    if (label && text)
      facts.push({
        label: labels[label] || label,
        value: text.slice(0, 2000),
        source,
        url,
      });
  };
  for (const row of (includeTables ? html : "").matchAll(
    /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi,
  )) {
    const cells = [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)];
    if (cells.length === 2) add(textHtml(cells[0][1]), cells[1][1]);
  }
  for (const cell of html.matchAll(
    /<div\b[^>]*\bdata-th=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi,
  ))
    add(cell[1], cell[2]);
  return facts;
}

// Only the series-detail block is content. Navigation, reviews and shop help are not.
export function phoenixSeriesMetadata(
  html: string,
  rawUrl: string,
): Partial<SeriesProfile> {
  const url = phoenixSeriesUrl(rawUrl);
  if (!url) return {};
  const source = "Phoenix Next";
  const detail =
    /<div\b[^>]*class=["'][^"']*\bseries-detail-wrap\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/i.exec(
      html,
    )?.[1] || "";
  if (!detail)
    throw new Error(
      "Phoenix Next series details are unavailable. Check the series URL and try again.",
    );
  const paragraphs = [...detail.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(
    (match) => descriptionText(match[1]),
  );
  const synopsisIndex = paragraphs.findIndex((text) =>
    /^(เรื่องย่อ|Synopsis)\s*[:：]?$/i.test(text),
  );
  const text = synopsisIndex >= 0 ? paragraphs[synopsisIndex + 1] || "" : "";
  const alternate =
    [...detail.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].find(
      (match) => !/<a\b/i.test(match[1]),
    )?.[1] || "";
  const heading = textHtml(
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(detail)?.[1] || "",
  );
  const titles = [
    ...(heading
      ? [{ title: heading, language: textLanguage(heading), source, url }]
      : []),
    ...alternate
      .split(/<br\s*\/?\s*>/i)
      .map(textHtml)
      .filter(Boolean)
      .map((title, index) => ({
        title,
        language:
          textLanguage(title) === "ja" ? "ja" : index === 1 ? "ja-Latn" : "en",
        source,
        url,
      })),
  ];
  const imageTags =
    html.slice(0, html.indexOf(detail)).match(/<img\b[^>]*>/gi) || [];
  const banner = imageTags
    .map((tag) => attr(tag, "src"))
    .find((src) => /\/media\/brand\//.test(src));
  const cover = attr((detail.match(/<img\b[^>]*>/i) || [""])[0], "src");
  const tags = [...detail.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].flatMap(
    (match) => {
      const href = attr(match[1], "href");
      return /^https:\/\/www\.phoenixnext\.com\/(?:manga|light-novel)\/[\w-]+\.html$/.test(
        href,
      )
        ? [{ name: textHtml(match[2]), kind: "Genre", source, url }]
        : [];
    },
  );
  return mergeSeriesMetadata({
    titles,
    synopses: text ? [{ text, language: textLanguage(text), source, url }] : [],
    facts: htmlPublicationFacts(detail, source, url),
    tags,
    images: [
      ...(banner
        ? [{ kind: "banner" as const, url: banner, source, sourceUrl: url }]
        : []),
      ...(cover
        ? [{ kind: "cover" as const, url: cover, source, sourceUrl: url }]
        : []),
    ],
    links: [{ label: source, language: "th", url }],
  });
}

export function structuredPublicationFacts(
  html: string,
  source: string,
  url: string,
  isbn = "",
) {
  const products = structuredBooks(html);
  const product =
    products.find((item) =>
      isbn
        ? [item.isbn, item.gtin13, item.gtin, item.sku].some(
            (code) => canonicalIsbn(code) === isbn,
          )
        : item.url === url,
    ) || (!isbn && products.length === 1 ? products[0] : null);
  if (!product) return [];
  const names = (value: any): string =>
    Array.isArray(value)
      ? value.map(names).filter(Boolean).join(" · ")
      : typeof value === "object" && value
        ? names(value.name)
        : typeof value === "string"
          ? value
          : "";
  return [
    ["Author", names(product.author)],
    ["Artist", names(product.illustrator)],
    ["Publisher", names(product.publisher)],
    ["Translator", names(product.translator)],
    ["Release date", names(product.datePublished)],
    ["Language", names(product.inLanguage)],
    ["Format", names(product.bookFormat)],
    ["Pages", product.numberOfPages ? String(product.numberOfPages) : ""],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => ({ label, value, source, url }));
}
