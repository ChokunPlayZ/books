import { decodeHtml, attr, textHtml } from "./html.ts";
import { digest } from "./hash.ts";
import { publisherKey, safeSeriesCatalogUrl } from "./urls.ts";
import { animagCategories } from "./animag.ts";
import {
  catalogSeriesKey,
  bookSeriesTitle,
  seriesCategoryTitle,
} from "./title-normalization.ts";
export {
  catalogSeriesKey,
  bookSeriesTitle,
  seriesCategoryTitle,
} from "./title-normalization.ts";

export function specialSet(title) {
  return /\bspecial[\s_-]*(?:combo[\s_-]*)?set\b|(?:เซต|เซ็[ตท]|ชุด)\s*พิเศษ/i.test(
    decodeHtml(String(title || "")),
  );
}

export function volumeCoverKey(book) {
  if (book.volume === "" || book.volume == null || !book.type) return "";
  return (
    "cover:volume:v1:" +
    digest(
      JSON.stringify([
        book.publisherId || publisherKey(book.publisher),
        catalogSeriesKey(book.catalogSeries || book.series),
        book.type.replace(/\s*\(colou?r\)/gi, "").trim(),
        Number(book.volume),
      ]),
    )
  );
}

export function releaseBundle(title) {
  return /box\s*set|ครบชุด|ยกชุด|(?:เล่ม(?:ที่)?|vol(?:ume)?\.?)\s*\d+(?:\.\d+)?\s*(?:[-–—~]|ถึง)\s*\d/i.test(
    title,
  );
}

export function parseSeriesCategories(id, html) {
  if (id === "animag") return animagCategories(html);
  const categories = new Map(),
    anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  anchors.forEach(function (anchor) {
    const url = safeSeriesCatalogUrl(
      attr(anchor.slice(0, anchor.indexOf(">") + 1), "href"),
      id,
    );
    const title = textHtml(
      anchor.slice(anchor.indexOf(">") + 1, anchor.lastIndexOf("</a>")),
    )
      .replace(/(?:\s*\(\d+\)\s*รายการ|\s*\[\d+\])\s*$/, "")
      .trim();
    const rawUrl = attr(anchor.slice(0, anchor.indexOf(">") + 1), "href");
    const type =
      id === "firstpage"
        ? /\/light-novel/i.test(rawUrl)
          ? "LN (TH)"
          : /\/manga/i.test(rawUrl)
            ? "Manga (TH)"
            : ""
        : "";
    if (url && title && !categories.has(url))
      categories.set(url, { title: title, url: url, type: type });
  });
  return Array.from(categories.values()).sort(function (a, b) {
    return a.title.localeCompare(b.title);
  });
}

export function matchSeriesCategory(series, categories, type) {
  categories = categories.filter(function (category) {
    return (
      !type ||
      !category.type ||
      category.type.split(" (")[0] === type.split(" (")[0]
    );
  });
  const key = catalogSeriesKey(series);
  const exact = categories.filter(function (c) {
    return catalogSeriesKey(c.title) === key;
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null; // Several formats can share the same title.
  // First Page sometimes names the series category after its first volume.
  // Strip only a stated volume at the end, preserving numbers in series names.
  const numbered = categories.filter(function (c) {
    return catalogSeriesKey(seriesCategoryTitle(c.title)) === key;
  });
  if (numbered.length === 1) return numbered[0];
  if (numbered.length > 1) return null;
  const slug = categories.filter(function (c) {
    return (
      catalogSeriesKey(
        c.url
          .split("/")
          .pop()
          .replace(/\.html$/, ""),
      ) === key
    );
  });
  return slug.length === 1 ? slug[0] : null;
}

export function splitBookTitle(raw): {
  series: string;
  volume: number | "";
  type: string;
} {
  let title = decodeHtml(String(raw || ""))
    .replace(/\s+/g, " ")
    .trim();
  const type = /\(LN\)|\(นิยาย\)|^นิยาย|light\s*novel|ไลท์โนเวล/i.test(title)
    ? "LN (TH)"
    : /มังงะ|การ์ตูน|@COMIC|\(Mg\)/i.test(title)
      ? "Manga (TH)"
      : "";
  title = title
    .replace(/^\[PRE-ORDER\]\s*/i, "")
    .replace(/^(?:\(LN\)|\(มังงะ\)|\(นิยาย\)|นิยาย|การ์ตูน)\s*/i, "");
  const explicit = /(?:เล่ม(?:ที่)?|vol(?:ume)?\.?)\s*(\d+(?:\.\d+)?)/i.exec(
    title,
  );
  // Luckpim also uses bare volume numbers before ending/format labels or promotions.
  const suffix =
    /\s+(\d+(?:\.\d+)?)(?=\s*(?:$|(?:\([^)]*\)\s*)+$|\[|แถม|ฟรี|พร้อม))/i.exec(
      title,
    );
  const match = explicit || suffix;
  let series = match
    ? title.slice(0, match.index).trim()
    : title.replace(/\s*\((?:Mg|LN)\)\s*$/i, "").trim();
  series = bookSeriesTitle(series.replace(/\s*[-–:]\s*$/, ""));
  return { series: series, volume: match ? Number(match[1]) : "", type: type };
}

export function splitFirstPageTitle(raw: string) {
  let title = decodeHtml(String(raw || ""))
    .replace(/\s+/g, " ")
    .trim();
  // Promotions precede the actual format label on special/pre-order editions.
  const promotion =
    /^(?:\[PRE[- ]ORDER\]\s*|(?:(?:special|complete|ultimate|limited)(?:\s+combo)?\s+(?:set|edition)|box\s+set)\s+(?:[AB]\s+)?(?:\(Exclusive Pre-order Period\)\s*)?)/i;
  while (promotion.test(title)) title = title.replace(promotion, "").trim();
  const parsed = splitBookTitle(title);
  // A leading publisher label is stronger evidence than words inside a name.
  const type = /^(?:\(LN\)|\(นิยาย\)|นิยาย|light\s*novel\b|ไลท์โนเวล)/i.test(
    title,
  )
    ? "LN (TH)"
    : /^(?:\(มังงะ\)|มังงะ|การ์ตูน|\(Mg\)|manga\b|@comic\b)/i.test(title)
      ? "Manga (TH)"
      : parsed.type;
  return { ...parsed, type };
}

export function splitAnimagTitle(raw: string) {
  const title = decodeHtml(String(raw || ""))
    .replace(
      /^\s*(?:\((?:พรีออเดอร์|พรีออร์เดอร์|PRE[- ]?ORDER)\)|\[PRE[- ]?ORDER\])\s*/i,
      "",
    )
    .replace(/^\s*Animag\s+/i, "")
    .replace(/\s*\((?:ทยอยจัดส่ง|จัดส่ง)[^)]*\)\s*$/i, "")
    .trim();
  const type = /\b(?:NOVEL|LIGHT\s*NOVEL)\b/i.test(title)
    ? "LN (TH)"
    : /\b(?:COMIC|MANGA)\b/i.test(title)
      ? "Manga (TH)"
      : "";
  const parsed = splitBookTitle(
    title.replace(/\b(?:LIGHT\s*NOVEL|NOVEL|COMIC|MANGA)\b/gi, " "),
  );
  parsed.series = parsed.series
    .replace(/\s*เล่มเดียวจบ.*$/i, "")
    .replace(/\s+(?:Limited(?:\s+Edition)?|BOXSET)\b.*$/i, "")
    .trim();
  if (parsed.volume === "" && /เล่มเดียวจบ/.test(title)) parsed.volume = 1;
  return { ...parsed, type: type || parsed.type };
}

export function splitDexpressTitle(raw: string) {
  const title = decodeHtml(String(raw || ""))
    .replace(/^\s*\[(?:PRE[- ]?ORDER|พรีออ(?:ร์)?เดอร์)\]\s*/i, "")
    .replace(/^\s*\[DEXPRESS\]\s*/i, "")
    .trim();
  const type = /ฉบับการ์ตูน|มังงะ|\bmanga\b/i.test(title)
    ? "Manga (TH)"
    : /นิยาย|\bnovel\b/i.test(title)
      ? "LN (TH)"
      : "";
  const parsed = splitBookTitle(
    title
      .replace(/^(?:(?:Animate\s+)?Limited\s+set|AUTOGRAPH\s+SET)\s*/i, "")
      .replace(/\s*ฉบับการ์ตูน\s*/gi, " ")
      .replace(/\bLv\.\s*(\d+(?:\.\d+)?)/i, "เล่ม $1")
      .replace(/\s*\((?:จบ|เล่มเดียวจบ)\)\s*$/i, ""),
  );
  parsed.series = parsed.series.replace(/\s*เล่มเดียวจบ.*$/, "").trim();
  if (parsed.volume === "" && /เล่มเดียวจบ/.test(title)) parsed.volume = 1;
  return { ...parsed, type: type || parsed.type };
}

export function splitLilyHouseTitle(raw: string) {
  const title = decodeHtml(String(raw || ""))
    .replace(/^\s*\((?:PRE(?:[- ]?ORDER)?|COMIC|NOVEL)\)\s*/gi, "")
    .replace(/^\s*\((?:COMIC|NOVEL)\)\s*/i, "")
    .replace(/\s*\(English (?:Version|Edition)\)\s*/gi, " ")
    .trim();
  const parsed = splitBookTitle(title);
  parsed.series = parsed.series
    .replace(/\s*\((?:ฉบับ\s*)?reprint\)\s*$/i, "")
    .trim();
  if (parsed.volume === "" && /เล่มเดียวจบ/.test(title)) {
    parsed.series = parsed.series.replace(/\s*\(?เล่มเดียวจบ\)?.*$/, "").trim();
    parsed.volume = 1;
  }
  return parsed;
}
