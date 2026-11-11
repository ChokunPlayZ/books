import {
  attr,
  descriptionText as synopsisText,
  structuredBooks,
  textHtml,
} from "./html.ts";
import { animeCatalogTitleKeys } from "./anime.ts";
export { descriptionText as synopsisText } from "./html.ts";

export type SeriesTitle = {
  title: string;
  language: string;
  source: string;
  url: string;
};
export type Synopsis = {
  text: string;
  language: string;
  source: string;
  url: string;
};
export type SeriesProfile = {
  workId: string;
  titles: SeriesTitle[];
  synopses: Synopsis[];
  manual?: boolean;
};
export type SeriesInfo = SeriesProfile & {
  series: string;
  type: string;
  editions: { series: string; type: string; language: string; count: number }[];
  candidates: { id: number; title: string; titles: string[]; url: string }[];
  warnings: string[];
};

export function textLanguage(text: string): string {
  if (/\p{Script=Thai}/u.test(text)) return "th";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text))
    return "ja";
  return /[a-z]/i.test(text) ? "en" : "und";
}

export function publicSourceUrl(value: unknown) {
  try {
    const url = new URL(String(value));
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port
    )
      return url.href;
  } catch {}
  return "";
}

export function mergeSeriesMetadata(...records: Partial<SeriesProfile>[]) {
  const titles = new Map<string, SeriesTitle>();
  const synopses = new Map<string, Synopsis>();
  for (const record of records) {
    for (const item of Array.isArray(record?.titles) ? record.titles : []) {
      const title = synopsisText(item?.title).slice(0, 500);
      const url = publicSourceUrl(item?.url);
      if (!title || !url) continue;
      const next = {
        title,
        language: String(item.language || "und").slice(0, 20),
        source: synopsisText(item.source).slice(0, 200),
        url,
      };
      titles.set(JSON.stringify([next.language, title, url]), next);
    }
    for (const item of Array.isArray(record?.synopses) ? record.synopses : []) {
      const text = synopsisText(item?.text);
      const url = publicSourceUrl(item?.url);
      if (!text || !url) continue;
      const next = {
        text,
        language: String(item.language || textLanguage(text)).slice(0, 20),
        source: synopsisText(item.source).slice(0, 200),
        url,
      };
      synopses.set(JSON.stringify([next.language, text, url]), next);
    }
  }
  const order = (a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b), "en");
  return {
    titles: [...titles.values()].sort(order),
    synopses: [...synopses.values()].sort(order),
  };
}

export function seriesAliasesMatch(aliases: string[], title: string) {
  const keys = new Set(
    aliases.flatMap((name) => [...animeCatalogTitleKeys(name)]),
  );
  return [...animeCatalogTitleKeys(title)].some((key) => keys.has(key));
}

// Only explicitly labeled original/translated names count as identity evidence.
// Arbitrary prose mentions must not link a sequel or an unrelated series.
export function descriptionTitles(
  description: string,
  source: string,
  url: string,
): SeriesTitle[] {
  const lines = description
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .split(/[\n\r]+/);
  return lines.flatMap((line) => {
    const match =
      /(?:^|\s)(original title|japanese title|english title|romaji(?: title)?|romanji(?: title)?|romanized title|ชื่อเรื่องต้นฉบับ|ชื่อเรื่องภาษาญี่ปุ่น|ชื่อภาษาญี่ปุ่น|ชื่อภาษาอังกฤษ|ชื่อเรื่องภาษาอังกฤษ|ชื่อเรื่องเดิม)\s*[:：]\s*(.+)$/i.exec(
        textHtml(line),
      );
    if (!match) return [];
    const title = match[2].trim().slice(0, 500);
    const language = /romaji|romanji|romanized/i.test(match[1])
      ? "ja-Latn"
      : /english|อังกฤษ/i.test(match[1])
        ? "en"
        : textLanguage(title);
    return title ? [{ title, language, source, url }] : [];
  });
}

export function htmlSeriesMetadata(
  html: string,
  source: string,
  url: string,
  isbn = "",
) {
  const structured = structuredBooks(html).find((book) => {
    const code = String(
      book.isbn || book.gtin13 || book.gtin || book.sku || "",
    ).replace(/\D/g, "");
    return !isbn || code === isbn || (!code && book.url === url);
  });
  const description =
    typeof structured?.description === "string" ? structured.description : "";
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const metaDescription = metaTags.find((tag) =>
    /^(?:og:description|description)$/i.test(
      attr(tag, "property") || attr(tag, "name"),
    ),
  );
  const start =
    /<(div|section|article|p)\b(?=[^>]*(?:itemprop=["']description["']|(?:id|class)=["'][^"']*(?:product-description|product_description|product attribute description|entry-content|product-detail-description|book-description)[^"']*["']))[^>]*>/i.exec(
      html,
    );
  let productDescription = "";
  if (start) {
    const tags = new RegExp("<\\/?" + start[1] + "\\b[^>]*>", "gi");
    tags.lastIndex = start.index + start[0].length;
    let depth = 1;
    for (let tag; (tag = tags.exec(html));) {
      depth += /^<\//.test(tag[0]) ? -1 : 1;
      if (!depth) {
        productDescription = html.slice(
          start.index + start[0].length,
          tag.index,
        );
        break;
      }
    }
  }
  const raw =
    productDescription ||
    description ||
    (metaDescription ? attr(metaDescription, "content") : "");
  const text = synopsisText(raw);
  // A site's interface language need not be the language of the book synopsis.
  const language = textLanguage(text);
  return mergeSeriesMetadata({
    titles: descriptionTitles(
      [description, productDescription, raw].join("\n"),
      source,
      url,
    ),
    synopses: text ? [{ text, language, source, url }] : [],
  });
}
