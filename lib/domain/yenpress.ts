import { attr, textHtml } from "./html.ts";
import { canonicalIsbn } from "./isbn.ts";
import { safeCoverUrl, safeProductUrl } from "./urls.ts";
import { splitBookTitle } from "./titles.ts";

export function yenPressSearchKey(html: string): string {
  const raw = /\bvar\s+_elastic\s*=\s*(\{[^;]+\});/.exec(html)?.[1];
  const config = raw ? JSON.parse(raw) : null;
  if (
    config?.url !== "https://enterprise-search.yenpress.com/" ||
    config?.engine !== "yenpress" ||
    typeof config.search_key !== "string" ||
    !/^search-[a-zA-Z0-9]+$/.test(config.search_key)
  )
    throw new Error("Yen Press search configuration changed.");
  return config.search_key;
}

export function yenPressCandidates(data: unknown, isbn: string): string[] {
  if (
    !data ||
    typeof data !== "object" ||
    !("results" in data) ||
    !Array.isArray(data.results)
  )
    throw new Error("Yen Press search response changed.");
  const urls = new Set<string>();
  for (const result of data.results) {
    if (
      !result ||
      canonicalIsbn(result.isbn?.raw) !== isbn ||
      typeof result.url?.raw !== "string"
    )
      continue;
    try {
      const url = safeProductUrl(
        new URL(result.url.raw, "https://yenpress.com").href,
        "yenpress",
      );
      if (url) urls.add(url);
    } catch {}
    if (urls.size === 4) break;
  }
  return [...urls];
}

export function yenPressBook(html: string, isbn: string, url: string) {
  const title = textHtml(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || "");
  const sections = [
    ...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi),
  ];
  const heading =
    sections.find((section) =>
      attr(section[0].slice(0, section[0].indexOf(">") + 1), "class")
        .split(/\s+/)
        .includes("series-heading"),
    )?.[1] || "";
  const details = sections.find((section) =>
    attr(section[0].slice(0, section[0].indexOf(">") + 1), "class")
      .split(/\s+/)
      .includes("book-details"),
  )?.[1];
  if (!title || !details) throw new Error("Yen Press book markup changed.");
  const category =
    /href=["']\/category\/(light-novels|novels|manga|comics)["']/i.exec(
      heading,
    )?.[1] ||
    /href=["']\/genres\?category=(novels|manga|comics)(?:&|["'])/i.exec(
      details,
    )?.[1];
  const starts = [...details.matchAll(/<div\b[^>]*>/gi)].filter((tag) =>
    attr(tag[0], "class").split(/\s+/).includes("detail-info"),
  );
  if (!starts.length) throw new Error("Yen Press edition details changed.");
  let hasIsbn = false;
  for (let index = 0; index < starts.length; index++) {
    const block = details.slice(starts[index].index, starts[index + 1]?.index);
    const fields = new Map<string, string>();
    for (const field of block.matchAll(
      /<span\b[^>]*>\s*(Series|ISBN|Release Date|Imprint)\s*<\/span>\s*<p\b[^>]*>([\s\S]*?)<\/p>/gi,
    )) {
      const label = field[1].toLowerCase();
      if (!fields.has(label)) fields.set(label, textHtml(field[2]));
    }
    hasIsbn ||= !!canonicalIsbn(fields.get("isbn"));
    if (canonicalIsbn(fields.get("isbn")) !== isbn) continue;
    const authors = new Set<string>();
    for (const author of html.matchAll(
      /<p\b[^>]*>\s*(?:Original\s+)?Author:\s*<span\b[^>]*>([\s\S]*?)<\/span>\s*<\/p>/gi,
    )) {
      const name = textHtml(author[1]);
      if (name) authors.add(name);
    }
    const image = (html.match(/<img\b[^>]*>/gi) || []).find(
      (tag) => attr(tag, "alt").toLowerCase() === "series cover",
    );
    const parsed = splitBookTitle(title);
    return {
      isbn,
      title,
      series: fields.get("series") || parsed.series.replace(/,\s*$/, ""),
      volume: parsed.volume,
      type: /^(?:light-novels|novels)$/i.test(category || "")
        ? "LN (EN)"
        : /^(?:manga|comics)$/i.test(category || "")
          ? "Manga (EN)"
          : "",
      publisher: fields.get("imprint") || "Yen Press",
      authors: [...authors].join(", "),
      releaseDate: fields.get("release date") || "",
      source: "Yen Press",
      url,
      coverUrl: image
        ? safeCoverUrl(attr(image, "data-src") || attr(image, "src"), url)
        : "",
    };
  }
  if (!hasIsbn) throw new Error("Yen Press edition ISBNs unavailable.");
  return null;
}
