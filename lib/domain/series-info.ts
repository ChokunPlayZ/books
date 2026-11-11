import {
  attr,
  descriptionText as synopsisText,
  structuredBooks,
  textHtml,
} from "./html.ts";
import { animeCatalogTitleKeys } from "./anime.ts";
import { canonicalIsbn } from "./isbn.ts";
import { safeCoverUrl } from "./urls.ts";
import {
  htmlPublicationFacts,
  structuredPublicationFacts,
} from "./series-sources.ts";
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
  facts?: SeriesFact[];
  tags?: SeriesTag[];
  images?: SeriesImage[];
  links?: SeriesLink[];
};
export type SeriesFact = {
  label: string;
  value: string;
  source: string;
  url: string;
};
export type SeriesTag = {
  name: string;
  kind: string;
  source: string;
  url: string;
};
export type SeriesImage = {
  kind: "banner" | "cover";
  url: string;
  source: string;
  sourceUrl: string;
  coverId?: string;
  coverUrl?: string;
};
export type SeriesLink = { label: string; language: string; url: string };
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
  const facts = new Map<string, SeriesFact>();
  const tags = new Map<string, SeriesTag>();
  const images = new Map<string, SeriesImage>();
  const links = new Map<string, SeriesLink>();
  for (const record of records) {
    for (const item of Array.isArray(record?.facts) ? record.facts : []) {
      const label = synopsisText(item?.label).slice(0, 100);
      const value = synopsisText(item?.value).slice(0, 2000);
      const url = publicSourceUrl(item?.url);
      if (label && value && url)
        facts.set(JSON.stringify([label, value, url]), {
          label,
          value,
          url,
          source: synopsisText(item.source).slice(0, 200),
        });
    }
    for (const item of Array.isArray(record?.tags) ? record.tags : []) {
      const name = synopsisText(item?.name).slice(0, 200);
      const url = publicSourceUrl(item?.url);
      if (name && url)
        tags.set(JSON.stringify([name, url]), {
          name,
          url,
          kind: synopsisText(item.kind || "Tag").slice(0, 100),
          source: synopsisText(item.source).slice(0, 200),
        });
    }
    for (const item of Array.isArray(record?.images) ? record.images : []) {
      const url = safeCoverUrl(item?.url);
      const sourceUrl = publicSourceUrl(item?.sourceUrl);
      if (url && sourceUrl && ["banner", "cover"].includes(item.kind))
        images.set(JSON.stringify([item.kind, url]), {
          kind: item.kind,
          url,
          coverUrl: url,
          sourceUrl,
          source: synopsisText(item.source).slice(0, 200),
        });
    }
    for (const item of Array.isArray(record?.links) ? record.links : []) {
      const url = publicSourceUrl(item?.url);
      const label = synopsisText(item?.label).slice(0, 200);
      if (url && label)
        links.set(url, {
          url,
          label,
          language: String(item.language || "und").slice(0, 20),
        });
    }
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
      // Replace an older excerpt from this source, preserving other sources.
      synopses.set(JSON.stringify([next.language, next.source, url]), next);
    }
  }
  const order = (a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b), "en");
  return {
    titles: [...titles.values()].sort(order),
    synopses: [...synopses.values()].sort(order),
    ...(facts.size ? { facts: [...facts.values()] } : {}),
    ...(tags.size ? { tags: [...tags.values()] } : {}),
    ...(images.size ? { images: [...images.values()] } : {}),
    ...(links.size ? { links: [...links.values()] } : {}),
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

function elementBody(html: string, start: RegExpExecArray) {
  const tags = new RegExp("<\\/?" + start[1] + "\\b[^>]*>", "gi");
  tags.lastIndex = start.index + start[0].length;
  let depth = 1;
  for (let tag; (tag = tags.exec(html));) {
    depth += /^<\//.test(tag[0]) ? -1 : 1;
    if (!depth) return html.slice(start.index + start[0].length, tag.index);
  }
  return "";
}

function productDescription(html: string) {
  // Read inert source markup, including accordion/template contents. Never run
  // storefront scripts or include recommendations, payment help or shop terms.
  const markup = html.replace(
    /<!--[^]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,
    "",
  );
  const elements = /<(div|section|article|p)\b[^>]*>/gi;
  for (let start; (start = elements.exec(markup));) {
    const id = attr(start[0], "id");
    const classes = attr(start[0], "class").split(/\s+/);
    if (
      !attr(start[0], "itemprop").split(/\s+/).includes("description") &&
      !["description", "tab-description"].includes(id) &&
      !(id === "detail" && classes.includes("tabPanel")) &&
      !classes.some((name) =>
        [
          "product-description",
          "product_description",
          "product-detail-description",
          "book-description",
          "entry-content",
          "content-heading-txt",
        ].includes(name),
      ) &&
      !(classes.includes("product") && classes.includes("description"))
    )
      continue;
    let body = elementBody(markup, start);
    if (id === "detail") {
      const short =
        /<(div)\b[^>]*class=["'][^"']*\bshort_description\b[^"']*["'][^>]*>/i.exec(
          body,
        );
      if (short)
        body = body.replace(short[0] + elementBody(body, short) + "</div>", "");
      body = body.split(
        /<hr\b|<h[1-6]\b[^>]*>\s*(?:เงื่อนไข|วิธีการสั่งซื้อ|terms|conditions)/i,
      )[0];
    }
    body = body.replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, "");
    if (synopsisText(body)) return body;
  }
  return "";
}

export function htmlSeriesMetadata(
  html: string,
  source: string,
  url: string,
  isbn = "",
) {
  const structured = structuredBooks(html).find((book) => {
    const code = [book.isbn, book.gtin13, book.gtin, book.sku]
      .map(canonicalIsbn)
      .find(Boolean);
    return !isbn || code === isbn || (!code && book.url === url);
  });
  const description =
    typeof structured?.description === "string" ? structured.description : "";
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const titleKey = (value: string) =>
    synopsisText(value).toLocaleLowerCase().replace(/\s+/g, " ");
  const titles = new Set([
    ...structuredBooks(html).map((book) => titleKey(book.name || "")),
    ...metaTags
      .filter((tag) =>
        /^(?:og:title|title)$/i.test(
          attr(tag, "property") || attr(tag, "name"),
        ),
      )
      .map((tag) => titleKey(attr(tag, "content"))),
    ...[
      ...html.matchAll(/<(?:h1|title)\b[^>]*>([\s\S]*?)<\/(?:h1|title)>/gi),
    ].map((match) => titleKey(match[1])),
  ]);
  const body = productDescription(html);
  const raw =
    [
      body,
      description,
      ...metaTags
        .filter((tag) =>
          /^(?:og:description|description)$/i.test(
            attr(tag, "property") || attr(tag, "name"),
          ),
        )
        .map((tag) => attr(tag, "content")),
    ].find((value) => {
      const text = titleKey(value);
      return (
        text &&
        !titles.has(text) &&
        !/^(?:รายละเอียดสินค้า|description|product details|เรื่องย่อ)[.!…\s]*$/i.test(
          text,
        )
      );
    }) || "";
  const text = synopsisText(raw);
  // A site's interface language need not be the language of the book synopsis.
  const language = textLanguage(text);
  return mergeSeriesMetadata({
    titles: descriptionTitles([description, body, raw].join("\n"), source, url),
    synopses: text ? [{ text, language, source, url }] : [],
    facts: [
      ...structuredPublicationFacts(html, source, url, isbn),
      ...htmlPublicationFacts(body, source, url),
    ],
  });
}
