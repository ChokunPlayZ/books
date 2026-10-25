import {
  attr,
  catalogTotal,
  parseCatalog,
  parsePublisherTitles,
  safePublisherTitleUrl,
  textHtml,
  digest,
  PUBLISHERS,
} from "../../domain.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import type { Release } from "../../types.ts";
import type { CatalogResult, PublisherTitle, ScraperContext } from "./types.ts";

type HtmlCatalogOptions = {
  id: string;
  pagination: string;
  releaseUrl: string;
  releaseLimit: number;
  headingPrefix?: RegExp;
  expand?(items: Release[], refresh: boolean): Promise<Release[]>;
};

export function createHtmlCatalog(
  context: ScraperContext,
  options: HtmlCatalogOptions,
) {
  const { fetchText: fetchText_ } = context;
  const { id, pagination, releaseUrl, releaseLimit, headingPrefix, expand } =
    options;
  async function catalog(url: string, refresh = false): Promise<CatalogResult> {
    const items = new Map(),
      listingIds = new Set();
    let total = null,
      complete = false,
      pages = 0,
      title = "";
    for (let page = 1; page <= 20; page++) {
      let html;
      try {
        const endpoint = new URL(url);
        if (page > 1) endpoint.searchParams.set(pagination, String(page));
        html = await fetchText_(endpoint.href, refresh);
      } catch (error) {
        if (!items.size) throw error;
        break;
      }
      if (page === 1) {
        total = catalogTotal(id, html);
        const heading =
          /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html) ||
          /<title\b[^>]*>([^<]*)<\/title>/i.exec(html);
        title = heading
          ? textHtml(heading[1]).replace(headingPrefix || /^$/, "")
          : "";
      }
      const parsed = parseCatalog(id, html, url),
        before = listingIds.size;
      parsed.forEach((item) => listingIds.add(item.id));
      const expanded = expand ? await expand(parsed, refresh) : parsed;
      expanded.forEach(function (item) {
        items.set(item.id, item);
      });
      pages++;
      if (total !== null && listingIds.size === total) {
        complete = true;
        break;
      }
      if (!parsed.length) {
        if (page === 1 && total !== 0)
          throw new Error("Category markup changed");
        break;
      }
      if (listingIds.size === before) break; // A repeated page must not masquerade as a complete catalog.
      const next = (html.match(/<a\b[^>]*>/gi) || []).some(function (anchor) {
        const href = attr(anchor, "href"),
          param = pagination;
        return (
          href.indexOf(url) === 0 &&
          new RegExp("[?&]" + param + "=" + (page + 1) + "(?:&|$)").test(href)
        );
      });
      if (!next && (total === null || listingIds.size >= total)) break;
    }
    return {
      items: Array.from(items.values()),
      total: total,
      pages: pages,
      complete: complete,
      title: title,
    };
  }

  async function releases(refresh = false): Promise<Release[]> {
    let items = [];
    for (let page = 1; page <= 2; page++) {
      const endpoint = new URL(releaseUrl);
      if (page > 1) endpoint.searchParams.set(pagination, String(page));
      const url = endpoint.href;
      // Phoenix uses p, First Page Pro uses tskp.
      const html = await fetchText_(url, refresh, SCRAPE_TTL.releases);
      const parsed = parseCatalog(id, html, url);
      if (!parsed.length) {
        if (page === 1) throw new Error("Catalog unavailable");
        break;
      }
      items = items.concat(expand ? await expand(parsed, refresh) : parsed);
    }
    const seen = {};
    return items
      .filter(function (item) {
        if (seen[item.id]) return false;
        seen[item.id] = true;
        return true;
      })
      .slice(0, releaseLimit);
  }

  return { catalog, releases };
}

export async function htmlDirectory(
  context: ScraperContext,
  id: string,
  url: string,
  title: string,
  refresh = false,
  fetchUrl = url,
) {
  const html = await context.fetchText(fetchUrl, refresh, SCRAPE_TTL.directory);
  const titles: PublisherTitle[] = parsePublisherTitles(id, html, url);
  if (!titles.length) {
    // A pasted single-series category can omit its own link in navigation.
    const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    if (!safePublisherTitleUrl(url, id) || !heading)
      throw new Error("Directory markup unavailable");
    const name = textHtml(heading[1]);
    titles.push({
      id: id + ":title:" + digest(url),
      publisherId: id,
      url,
      publisher: PUBLISHERS.find((publisher) => publisher.id === id).name,
      series: name,
      title: name,
      categories: [{ url, type: "" }],
      type: "",
      volume: "",
      isbn: "",
      directory: true,
    });
  }
  return { titles, title };
}
